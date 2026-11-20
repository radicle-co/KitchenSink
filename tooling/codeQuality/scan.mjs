#!/usr/bin/env node
// staff-code-quality — deterministic scanner runner.
//
// Runs the locally-available scanners over a SCOPED file set (a diff, an explicit list, or a path sweep),
// normalises every result to one JSONL shape, and — the part that matters most — records for every tool
// whether it actually RAN over a non-zero target set. A scanner that analysed nothing reads exactly like a
// clean codebase; this runner refuses to let those two states look alike (status NO_TARGETS / SKIPPED /
// FAILED are never folded into "0 findings").
//
// It is EVIDENCE for the agent, never a verdict: it does not grade, dedupe across tools, or decide blocking.
//
// Usage:
//   node scan.mjs --repo <dir> [--base <ref> | --files <f…> | --all <path>] [--tools a,b,…]
//                 [--semgrep on|off] [--codeql off|ci|local (default: local)] [--knip on|off] [--out <dir>]
//
// Output (in --out, default $TMPDIR/scq/<repo path> — outside the work tree, never inside it):
//   status.json     scope + per-tool {status, targets, findings, findingsOnChangedLines, durationMs, detail}
//   findings.jsonl  {tool, rule, file, line, location, severity, message, onChangedLine, url?}
//                   location 'line' = file:line; 'file' = the whole file (line null); 'package' = workspace-wide
//                   (file and line null). A tool that does not locate a finding gets null, never a made-up line 1.
//   summary.md      human-readable table
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

import {
    defaultBaselinePath,
    excludeIgnored,
    gitIgnoredFiles,
    judgeForGate,
    parseReport,
    reportedIssueCount,
    workspaceDirs,
} from './boundariesCore.mjs';
import {
    NOT_APPLICABLE,
    cloneTouchesChangedLines,
    cruiseTargets,
    isApplicable,
    touchesModuleSurface,
} from './scanScope.mjs';
import {
    depcruiseEdgeSpecifier,
    envReads,
    importLine,
    jsonKeyLine,
    jsonSyntaxErrorLine,
    knipFindings,
    parseSherif,
    sherifLocations,
} from './findingLocations.mjs';

// The toolchain is this directory: its pinned node_modules sit beside these scripts (`npm ci` in tooling/codeQuality).
const SCQ_HOME = process.env['SCQ_HOME'] ?? dirname(fileURLToPath(import.meta.url));
const BIN = (name) => join(SCQ_HOME, 'node_modules', '.bin', name);

// ── args ────────────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = { tools: null, semgrep: 'on', codeql: 'local', knip: 'on', files: [] };
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') {
        while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
            opt.files.push(argv[++i]);
        }
    } else if (a.startsWith('--')) {
        opt[a.slice(2)] = argv[++i];
    }
}
const wanted = opt.tools ? new Set(opt.tools.split(',')) : null;

// ── process helper ──────────────────────────────────────────────────────────────────────────────────────
/** @sideEffect spawns a child process */
function sh(cmd, args, { cwd, env, timeoutMs = 1_800_000 } = {}) {
    const r = spawnSync(cmd, args, {
        cwd,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        timeout: timeoutMs,
    });
    return {
        code: r.status,
        out: r.stdout ?? '',
        err: (r.stderr ?? '') + (r.error ? String(r.error) : ''),
        timedOut: r.signal === 'SIGTERM',
    };
}
const has = (cmd) => sh('bash', ['-lc', `command -v ${cmd}`]).code === 0;

/**
 * The informative part of a failed tool's stderr, as one line. Pure.
 *
 * ⛔ TAKING THE FIRST N LINES THROWS THE CAUSE AWAY. ESLint fails by printing a banner — a blank line,
 * `Oops! Something went wrong! :(`, a blank line, `ESLint: <version>`, a blank line — and only THEN the real
 * message. A `slice(0, 3)` therefore captures the banner and nothing else, which is exactly what the
 * `eslint-overlay` crash in this repo reported for as long as it went undiagnosed: a status of FAILED whose
 * detail said `Oops! Something went wrong! :( ESLint: 10.9.1` and named no cause. This drops the known
 * boilerplate and the blank lines first, so what survives is the part a reader can act on.
 */
function errorSummary(text, lines = 6) {
    const boilerplate = /^(Oops! Something went wrong! :\(|ESLint: [\d.]+|$)/;
    const kept = text
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => !boilerplate.test(l.trim()));
    return (kept.length ? kept : text.split('\n').filter(Boolean)).slice(0, lines).join(' ').slice(0, 1200);
}

// ── scope ───────────────────────────────────────────────────────────────────────────────────────────────
const repo = sh('git', ['rev-parse', '--show-toplevel'], { cwd: resolve(opt.repo ?? '.') }).out.trim();
if (!repo) {
    console.error('scan.mjs: --repo is not inside a git work tree');
    process.exit(2);
}
// Default output lives OUTSIDE the work tree: the agent is read-only with respect to the repository.
const out = resolve(opt.out ?? join(tmpdir(), 'scq', repo.replaceAll(sep, '_')));
mkdirSync(out, { recursive: true });

/**
 * The repository's default branch, as `origin/<name>`. Pure-ish: reads git config only.
 *
 * ⚠️ `origin/HEAD` is the authority but is NOT always present — it is set by `clone` and by
 * `git remote set-head`, and a fetched-into-existing repo can lack it entirely. The fallbacks are ordered by
 * how much they assert: a real remote-tracking ref, then a local branch, then the bare name.
 */
function defaultBranch() {
    const head = sh('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd: repo }).out.trim();
    if (head) {
        return head.replace('refs/remotes/', '');
    }
    for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
        if (sh('git', ['rev-parse', '--verify', '--quiet', candidate], { cwd: repo }).code === 0) {
            return candidate;
        }
    }
    return 'HEAD';
}

let mergeBase = null;
let files = [];
/** The `git diff` selector for this scope, shared by the name list and the -U0 hunk read so they cannot disagree. */
let diffSelector = null;
let scopeLabel = '';
if (opt.files.length > 0) {
    files = opt.files.map((f) => relative(repo, resolve(repo, f)));
    scopeLabel = 'explicit files';
} else if (opt.all) {
    files = sh('git', ['ls-files', '--', opt.all], { cwd: repo }).out.split('\n').filter(Boolean);
    scopeLabel = `all:${opt.all}`;
} else if (
    !opt.base &&
    sh('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: repo }).out.trim()
) {
    // ⛔ A STAGED INDEX IS THE SCOPE, AND IT WINS OVER THE BRANCH. What is staged is what the author is
    // about to commit, so it is what a pre-commit gate owes an opinion on. The fallback below is the whole
    // branch, which on a repo that lands a feature as ONE amended commit is every file that commit touches —
    // measured here at 4,093 files and ~45 CodeQL databases for a five-file review. Scanning the branch to
    // judge five files is not thoroughness, it is the wrong question asked slowly.
    // ⚠️ Untracked files are deliberately NOT added in this mode: unstaged means not part of this commit.
    // An explicit `--base` still overrides, which is how a push-time gate asks for the branch on purpose.
    diffSelector = ['--cached'];
    files = sh('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: repo })
        .out.split('\n')
        .filter(Boolean);
    scopeLabel = 'staged';
} else {
    // Nothing staged (or an explicit `--base`): THIS BRANCH's own work.
    //
    // ⛔ THE BASE IS THE BRANCH'S UPSTREAM, NOT THE DEFAULT BRANCH, and the difference is not academic. A
    // repo that lands a feature as ONE amended commit has a branch whose diff against `main` is the entire
    // feature — measured here at 4,093 files and ~45 CodeQL databases while the work under review was five.
    // `@{upstream}` answers the question a gate before a push actually has: what does this branch carry that
    // the remote does not. Against a force-pushed amend that is the new delta, which is the right scope and a
    // tiny one. Pass `--base origin/main` to ask the cumulative question on purpose.
    // ⚠️ A branch with NO upstream (never pushed) has no such answer, so it falls back to the default branch:
    // everything the branch has added is genuinely new there, and a large scope is correct rather than slow.
    const upstream = sh('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
        cwd: repo,
    }).out.trim();
    const base = opt.base ?? (upstream || defaultBranch());
    mergeBase = sh('git', ['merge-base', base, 'HEAD'], { cwd: repo }).out.trim() || base;
    diffSelector = [mergeBase];
    const changed = sh('git', ['diff', '--name-only', '--diff-filter=ACMR', mergeBase], { cwd: repo }).out.split('\n');
    const untracked = sh('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repo }).out.split('\n');
    files = [...new Set([...changed, ...untracked])].filter(Boolean);
    scopeLabel = `branch vs ${base}${upstream && !opt.base ? ' (upstream)' : ''}`;
}
// ⚠️ The toolchain's own directory is out of scope for every tool: these are the published staff-code-quality scripts,
// kept as they were (owner ruling 2026-11-20), and their complexity is accepted debt. __tests__/ holds their behaviour.
const selfDir = `${relative(repo, SCQ_HOME)}${sep}`;
files = files.filter(
    (f) =>
        existsSync(join(repo, f)) &&
        statSync(join(repo, f)).isFile() &&
        !f.startsWith(relative(repo, out)) &&
        !f.startsWith(selfDir),
);

/** Changed line numbers per file (null = every line counts as changed: untracked, --files or --all scope). */
const changedLines = new Map();
if (diffSelector) {
    let cur = null;
    for (const line of sh('git', ['diff', '-U0', '--diff-filter=ACMR', ...diffSelector], { cwd: repo }).out.split(
        '\n',
    )) {
        if (line.startsWith('+++ ')) {
            cur = line.startsWith('+++ b/') ? line.slice(6) : null;
            if (cur) {
                changedLines.set(cur, new Set());
            }
        } else if (cur && line.startsWith('@@')) {
            const m = /\+(\d+)(?:,(\d+))?/.exec(line);
            if (m) {
                const start = Number(m[1]);
                const count = m[2] === undefined ? 1 : Number(m[2]);
                for (let n = start; n < start + count; n++) {
                    changedLines.get(cur).add(n);
                }
            }
        }
    }
}
const inScope = new Set(files);
/**
 * A whole-file finding counts when its file changed; a workspace-wide one sits on no line of the diff.
 * ⛔ A file OUTSIDE the scope is never "changed": whole-repo tools (sherif, turbo boundaries) report on files this diff
 * never touched, and counting those as changed lines made every PR answer for the repository's whole backlog.
 */
const onChanged = (file, line) => {
    if (file === null || !inScope.has(file)) {
        return false;
    }
    const set = changedLines.get(file);
    return set === undefined || line === null ? true : set.has(line);
};

const CODE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const codeFiles = files.filter((f) => CODE.has(extname(f)) && !f.endsWith('.d.ts'));
const pyFiles = files.filter((f) => extname(f) === '.py');
const workflowFiles = files.filter((f) => /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/.test(f));

/** Nearest ancestor directory (repo-relative) holding a package.json; '' = repo root. */
function packageRoot(file) {
    let dir = dirname(file);
    while (dir !== '.' && dir !== '') {
        if (existsSync(join(repo, dir, 'package.json'))) {
            return dir;
        }
        dir = dirname(dir);
    }
    return '';
}
function groupByPackage(list) {
    const g = new Map();
    for (const f of list) {
        const root = packageRoot(f);
        g.set(root, [...(g.get(root) ?? []), f]);
    }
    return g;
}
/** Strips line and block comments and trailing commas outside strings — turbo.json and tsconfig.json are JSONC. */
function stripJsonc(text) {
    let outText = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            outText += c;
            if (c === '\\') {
                outText += text[++i] ?? '';
            } else if (c === '"') {
                inString = false;
            }
        } else if (c === '"') {
            inString = true;
            outText += c;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            outText += '\n';
        } else if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                i++;
            }
            i++;
        } else {
            outText += c;
        }
    }
    return outText.replace(/,(\s*[}\]])/g, '$1');
}
const readJson = (p) => {
    try {
        return JSON.parse(stripJsonc(readFileSync(p, 'utf8')));
    } catch {
        return null;
    }
};

const rootPkg = readJson(join(repo, 'package.json'));

const manifestTouched = files.some(
    (f) => f.endsWith('package.json') || f === 'turbo.json' || f.endsWith('/turbo.json') || f === 'pnpm-workspace.yaml',
);
// ⛔ ONLY CHANGED FILES (owner ruling 2026-11-20). How many changed files each kind of tool could act on. scanVerdict.mjs
// reads this to tell a tool that rightly had nothing to do (NOT_APPLICABLE) from one that silently did nothing.
// `moduleSurface` is how many changed code files add or remove an export, an import or a require: knip builds the whole
// module graph, so it runs only when one did. A file with no diff (untracked, --files, --all) counts as having one.
const moduleSurfaceFiles = (() => {
    if (diffSelector === null || codeFiles.length === 0) {
        return codeFiles.length;
    }
    const diffed = codeFiles.filter((f) => changedLines.has(f));
    const diffText = sh('git', ['diff', '-U0', '--diff-filter=ACMR', ...diffSelector, '--', ...diffed], {
        cwd: repo,
    }).out;
    return codeFiles.length - diffed.length + (touchesModuleSurface(diffText) ? 1 : 0);
})();
const kinds = {
    code: codeFiles.length,
    python: pyFiles.length,
    codeInTsProject: codeFiles.filter((f) => existsSync(join(repo, packageRoot(f), 'tsconfig.json'))).length,
    manifest: manifestTouched ? 1 : 0,
    moduleSurface: moduleSurfaceFiles,
    workflow: workflowFiles.length,
};

// ── tools ───────────────────────────────────────────────────────────────────────────────────────────────
const findings = [];
const statuses = [];
const add = (f) => {
    const file = f.file === null ? null : f.file.startsWith(sep) ? relative(repo, f.file) : f.file;
    // `isTest` lets the agent grade test code by test standards (DAMP over DRY: duplicated setup in tests is
    // usually deliberate, a duplicated business rule in src is not).
    const isTest =
        /(^|\/)(__tests__|tests?|e2e|__fixtures__|__mocks__)\/|\.(test|spec|e2e|integration)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/.test(
            file ?? '',
        );
    const line = file === null ? null : (f.line ?? null);
    const location = file === null ? 'package' : line === null ? 'file' : 'line';
    findings.push({ ...f, file, line, location, isTest, onChangedLine: onChanged(file, line) });
};

async function tool(name, fn) {
    if (wanted && !wanted.has(name)) {
        return;
    }
    // A sweep (--all) asks every tool for the whole path; a change asks only the tools it holds files for.
    if (!opt.all && !isApplicable(name, kinds)) {
        statuses.push({
            tool: name,
            status: NOT_APPLICABLE,
            targets: 0,
            findings: 0,
            findingsOnChangedLines: 0,
            durationMs: 0,
            detail: "the change holds no file of this tool's kind",
        });
        return;
    }
    const t0 = Date.now();
    const before = findings.length;
    let s;
    try {
        s = await fn();
    } catch (err) {
        s = { status: 'FAILED', targets: 0, detail: err instanceof Error ? err.message : String(err) };
    }
    const mine = findings.slice(before);
    statuses.push({
        tool: name,
        status: s.status,
        targets: s.targets ?? 0,
        findings: mine.length,
        findingsOnChangedLines: mine.filter((f) => f.onChangedLine).length,
        durationMs: Date.now() - t0,
        detail: s.detail ?? '',
    });
}
const noTargets = (why) => ({ status: 'NO_TARGETS', targets: 0, detail: why });
const skipped = (why) => ({ status: 'SKIPPED', targets: 0, detail: why });

await tool('repo-eslint', () => {
    if (codeFiles.length === 0) {
        return noTargets('no JS/TS files in scope');
    }
    let targets = 0;
    const notes = [];
    for (const [root, group] of groupByPackage(codeFiles)) {
        const cwd = join(repo, root);
        const hasConfig = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts'].some(
            (c) => existsSync(join(cwd, c)) || existsSync(join(repo, c)),
        );
        const bin = [join(cwd, 'node_modules/.bin/eslint'), join(repo, 'node_modules/.bin/eslint')].find(existsSync);
        if (!hasConfig || !bin) {
            notes.push(`${root || '.'}: no repo eslint config/binary`);
            continue;
        }
        const r = sh(bin, ['--format', 'json', '--no-warn-ignored', ...group.map((f) => relative(root, f))], { cwd });
        if (r.code === 2 || !r.out.trim().startsWith('[')) {
            notes.push(`${root || '.'}: eslint failed: ${errorSummary(r.err)}`);
            continue;
        }
        for (const res of JSON.parse(r.out)) {
            targets++;
            for (const m of res.messages) {
                add({
                    tool: 'repo-eslint',
                    rule: m.ruleId ?? (m.fatal ? 'parse-error' : 'unknown'),
                    file: relative(repo, res.filePath),
                    line: m.line ?? null,
                    severity: m.severity === 2 ? 'error' : 'warning',
                    message: m.message,
                });
            }
        }
    }
    if (targets === 0) {
        return notes.length ? { status: 'SKIPPED', targets: 0, detail: notes.join('; ') } : noTargets('nothing linted');
    }
    return { status: 'ran', targets, detail: notes.join('; ') };
});

await tool('eslint-overlay', () => {
    if (codeFiles.length === 0) {
        return noTargets('no JS/TS files in scope');
    }
    if (!existsSync(BIN('eslint'))) {
        return skipped('toolchain not installed — run npm ci --legacy-peer-deps in tooling/codeQuality');
    }
    let targets = 0;
    const modes = [];
    const failures = [];
    const lint = (cwd, list, typeAware, isNext, reactVersion = '19.0') => {
        const r = sh(
            BIN('eslint'),
            [
                '--config',
                join(SCQ_HOME, 'overlayConfig.mjs'),
                '--no-config-lookup',
                '--no-warn-ignored',
                '--format',
                'json',
                ...list,
            ],
            {
                cwd,
                env: {
                    SCQ_TYPE_AWARE: typeAware ? '1' : '0',
                    SCQ_TSCONFIG_ROOT: cwd,
                    SCQ_NEXT: isNext ? '1' : '0',
                    SCQ_REACT_VERSION: reactVersion,
                },
            },
        );
        if (r.code === 2 || !r.out.trim().startsWith('[')) {
            throw new Error(`overlay eslint failed in ${cwd}: ${errorSummary(r.err)}`);
        }
        return JSON.parse(r.out);
    };
    for (const [root, group] of groupByPackage(codeFiles)) {
        const cwd = join(repo, root);
        const pkg = readJson(join(cwd, 'package.json')) ?? {};
        const deps = {
            ...rootPkg?.dependencies,
            ...rootPkg?.devDependencies,
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
        };
        const isNext = Boolean(deps.next);
        const reactVersion = (/\d+(\.\d+)?/.exec(deps.react ?? '') ?? ['19.0'])[0];
        const typeAware = existsSync(join(cwd, 'tsconfig.json'));
        const rel = group.map((f) => relative(root, f));
        // ⛔ ONE PACKAGE'S CRASH MUST NOT DISCARD THE OTHER FORTY-FOUR. This used to let `lint`'s throw
        // escape the loop, so a single rule crash in one package made the whole tool FAILED with 0 targets —
        // measured here: `features/account` threw on `n/no-sync`, and the overlay reported nothing for the
        // entire repository while looking like one bad package. The failure is RECORDED and the loop goes on;
        // the tool still reports FAILED at the end, because a package that did not lint proved nothing about
        // itself — but every package that DID lint keeps its findings.
        let results;
        try {
            results = lint(cwd, rel, typeAware, isNext, reactVersion);
        } catch (err) {
            failures.push(`${root || '.'}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        if (typeAware) {
            const fatal = results
                .filter((res) => res.messages.some((m) => m.fatal))
                .map((res) => relative(cwd, res.filePath));
            if (fatal.length > 0) {
                results = results
                    .filter((res) => !fatal.includes(relative(cwd, res.filePath)))
                    .concat(lint(cwd, fatal, false, isNext, reactVersion));
                modes.push(
                    `${root || '.'}: ${fatal.length} file(s) outside the tsconfig project → syntactic rules only`,
                );
            }
        }
        modes.push(
            `${root || '.'}: ${typeAware ? 'type-aware' : 'syntactic (no tsconfig.json)'}${isNext ? ' +next' : ''}`,
        );
        for (const res of results) {
            targets++;
            for (const m of res.messages) {
                add({
                    tool: 'eslint-overlay',
                    rule: m.ruleId ?? (m.fatal ? 'parse-error' : 'unknown'),
                    file: relative(repo, res.filePath),
                    line: m.line ?? null,
                    severity: m.severity === 2 ? 'error' : 'warning',
                    message: m.message.split('\n')[0],
                });
            }
        }
    }
    // ⛔ A PARTIAL RUN IS A FAILED RUN, and it says which packages were lost. The findings from the packages
    // that linted are kept and reported — throwing them away would punish the healthy packages for a sick one
    // — but the STATUS stays FAILED, because this skill's own rule is that a tool which did not run over a
    // target proved nothing about it, and `ran` over 44 of 45 packages would read as a clean 45.
    if (failures.length > 0) {
        return {
            status: 'FAILED',
            targets,
            detail: `${failures.length} package(s) did not lint — ${failures.join(' | ')}${modes.length ? `; linted: ${modes.join('; ')}` : ''}`,
        };
    }
    return targets ? { status: 'ran', targets, detail: modes.join('; ') } : noTargets('nothing linted');
});

await tool('depcruise', () => {
    const ts = codeFiles.filter((f) => existsSync(join(repo, packageRoot(f), 'tsconfig.json')));
    if (ts.length === 0) {
        return noTargets('no JS/TS files under a package with tsconfig.json');
    }
    if (!existsSync(BIN('depcruise'))) {
        return skipped('toolchain not installed');
    }
    let targets = 0;
    const notes = [];
    for (const [root, group] of groupByPackage(ts)) {
        const cwd = join(repo, root);
        const own = [
            '.dependency-cruiser.js',
            '.dependency-cruiser.cjs',
            '.dependency-cruiser.mjs',
            '.dependency-cruiser.json',
        ]
            .map((c) => join(cwd, c))
            .find(existsSync);
        const config = own ?? join(SCQ_HOME, 'depcruiseConfig.cjs');
        // The changed files, not their package: depcruise follows their imports, so a cycle through one is still found.
        const targetsHere = cruiseTargets(root, group);
        const r = sh(
            BIN('depcruise'),
            ['--config', config, '--ts-config', 'tsconfig.json', '--output-type', 'json', ...targetsHere],
            { cwd },
        );
        if (!r.out.trim().startsWith('{')) {
            throw new Error(`depcruise failed in ${root || '.'}: ${r.err.split('\n').slice(0, 4).join(' ')}`);
        }
        const res = JSON.parse(r.out);
        targets += res.summary.totalCruised;
        if (res.summary.totalCruised === 0) {
            notes.push(`${root || '.'}: 0 modules cruised (TypeScript compiler not visible?)`);
        }
        notes.push(`${root || '.'}: ${own ? 'repo config' : 'advisory baseline config'}`);
        const inPkg = (p) => join(root, p);
        for (const v of res.summary.violations) {
            // An orphan is a fact about who imports a module, and a cruise from the changed files never sees an
            // importer outside them, so every changed file would read as one.
            if (v.rule.name === 'no-orphans') {
                continue;
            }
            const members = [v.from, v.to, ...(v.cycle ?? []).map((c) => (typeof c === 'string' ? c : c.name))];
            const member = inScope.has(inPkg(v.from)) ? v.from : members.find((m) => inScope.has(inPkg(m)));
            if (member === undefined) {
                continue;
            }
            const file = inPkg(member);
            // The line of the import this member wrote for the violating edge; null for a whole-module rule (an orphan)
            // or when the member holds no such import (the imported side of a dependency rule).
            const specifier = depcruiseEdgeSpecifier(v, res.modules, member);
            const line = specifier === null ? null : importLine(readFileSync(join(repo, file), 'utf8'), specifier);
            add({
                tool: 'depcruise',
                rule: v.rule.name,
                file,
                line,
                severity: v.rule.severity,
                message: v.cycle
                    ? `cycle: ${[v.from, ...(v.cycle ?? []).map((c) => (typeof c === 'string' ? c : c.name))].join(' → ')}`
                    : `${v.from} → ${v.to}`,
            });
        }
    }
    return targets
        ? { status: 'ran', targets, detail: notes.join('; ') }
        : { status: 'NO_TARGETS', targets: 0, detail: notes.join('; ') };
});

await tool('jscpd', () => {
    if (codeFiles.length === 0) {
        return noTargets('no JS/TS files in scope');
    }
    if (!existsSync(BIN('jscpd'))) {
        return skipped('toolchain not installed');
    }
    let targets = 0;
    for (const [root] of groupByPackage(codeFiles)) {
        const report = join(out, 'jscpd', root.replaceAll('/', '__') || 'root');
        // jscpd 5.x respects .gitignore by default (the flag is `--no-gitignore`); an unknown flag makes it exit
        // non-zero with no report, which must surface as FAILED — never as "saw no sources".
        const r = sh(
            BIN('jscpd'),
            [
                '--min-tokens',
                '50',
                '--reporters',
                'json',
                '--output',
                report,
                '--silent',
                '--ignore',
                '**/node_modules/**,**/dist/**,**/.next/**,**/coverage/**,**/*.d.ts',
                join(repo, root),
            ],
            { cwd: repo },
        );
        const res = readJson(join(report, 'jscpd-report.json'));
        if (!res) {
            throw new Error(
                `jscpd produced no report for ${root || '.'} (exit ${r.code}): ${errorSummary(r.err + r.out)}`,
            );
        }
        targets += res.statistics.total.sources;
        for (const d of res.duplicates) {
            // jscpd reports paths relative to the directory it scanned (the package root), not the repo.
            const pkgDir = join(repo, root);
            const a = relative(repo, resolve(pkgDir, d.firstFile.name));
            const b = relative(repo, resolve(pkgDir, d.secondFile.name));
            // Only a clone with one side on a changed line: the rest is the repository's own backlog.
            const touches = (name, side) => inScope.has(name) && cloneTouchesChangedLines(side, changedLines.get(name));
            const aSide = touches(a, d.firstFile);
            if (!aSide && !touches(b, d.secondFile)) {
                continue;
            }
            const [file, other] = aSide ? [a, d.secondFile] : [b, d.firstFile];
            const start = aSide ? d.firstFile.start : d.secondFile.start;
            add({
                tool: 'jscpd',
                rule: 'duplicate-code',
                file,
                line: start,
                severity: 'warning',
                message: `${d.lines} duplicated lines with ${relative(repo, resolve(pkgDir, other.name))}:${other.start}`,
            });
        }
    }
    return targets ? { status: 'ran', targets } : noTargets('jscpd saw no sources');
});

await tool('semgrep', () => {
    const targetsList = [...codeFiles, ...pyFiles];
    if (opt.semgrep === 'off') {
        return skipped('--semgrep off');
    }
    if (targetsList.length === 0) {
        return noTargets('no code files in scope');
    }
    const runner = has('semgrep') ? ['semgrep'] : has('uvx') ? ['uvx', 'semgrep'] : null;
    if (!runner) {
        return skipped('neither semgrep nor uvx on PATH');
    }
    // `p/<lang>` packs are thin (~74 rules) and missed a seeded child_process injection; p/default + r/<lang>
    // loaded 256 rules and caught it (measured 2026-09-13, semgrep 1.177.0).
    const configs = [
        'p/default',
        'p/security-audit',
        ...(codeFiles.length ? ['r/javascript', 'r/typescript'] : []),
        ...(pyFiles.length ? ['r/python'] : []),
    ];
    const r = sh(
        runner[0],
        [
            ...runner.slice(1),
            'scan',
            ...configs.flatMap((c) => ['--config', c]),
            '--metrics',
            'off',
            '--json',
            '-q',
            ...targetsList,
        ],
        { cwd: repo, timeoutMs: 900_000 },
    );
    if (!r.out.trim().startsWith('{')) {
        throw new Error(`semgrep failed: ${r.err.split('\n').slice(-4).join(' ')}`);
    }
    const res = JSON.parse(r.out);
    for (const x of res.results) {
        add({
            tool: 'semgrep',
            rule: x.check_id,
            file: x.path,
            line: x.start.line,
            severity: String(x.extra.severity).toLowerCase(),
            message: x.extra.message.split('\n')[0],
            url: x.extra.metadata?.source,
        });
    }
    const scanned = res.paths?.scanned?.length ?? 0;
    return scanned
        ? { status: 'ran', targets: scanned, detail: configs.join(' ') }
        : noTargets('semgrep scanned 0 paths');
});

const RUFF_EXTEND = 'B,S,BLE,E722,DTZ,C90,PLR,PLW,ERA,T20,TRY,EM,PERF,FBT,ARG,ASYNC,PIE,SIM,RET,UP,ANN,RUF';
await tool('ruff', () => {
    if (pyFiles.length === 0) {
        return noTargets('no Python files in scope');
    }
    const runner = has('ruff') ? ['ruff'] : has('uvx') ? ['uvx', 'ruff'] : null;
    if (!runner) {
        return skipped('neither ruff nor uvx on PATH');
    }
    const r = sh(
        runner[0],
        [
            ...runner.slice(1),
            'check',
            '--output-format',
            'json',
            '--no-cache',
            '--exit-zero',
            '--extend-select',
            RUFF_EXTEND,
            ...pyFiles,
        ],
        { cwd: repo },
    );
    if (!r.out.trim().startsWith('[')) {
        throw new Error(`ruff failed: ${errorSummary(r.err)}`);
    }
    for (const x of JSON.parse(r.out)) {
        add({
            tool: 'ruff',
            rule: x.code ?? 'syntax-error',
            file: relative(repo, x.filename),
            line: x.location.row,
            severity: 'warning',
            message: x.message,
            url: x.url,
        });
    }
    return { status: 'ran', targets: pyFiles.length, detail: `repo config + --extend-select ${RUFF_EXTEND}` };
});

await tool('mypy', () => {
    if (pyFiles.length === 0) {
        return noTargets('no Python files in scope');
    }
    const runner = has('mypy') ? ['mypy'] : has('uvx') ? ['uvx', 'mypy'] : null;
    if (!runner) {
        return skipped('neither mypy nor uvx on PATH');
    }
    const r = sh(
        runner[0],
        [
            ...runner.slice(1),
            '--strict',
            '--ignore-missing-imports',
            '--no-error-summary',
            '--output',
            'json',
            ...pyFiles,
        ],
        { cwd: repo },
    );
    for (const line of r.out.split('\n').filter((l) => l.startsWith('{'))) {
        const x = JSON.parse(line);
        add({
            tool: 'mypy',
            rule: x.code ?? 'mypy',
            file: x.file,
            line: x.line,
            severity: x.severity,
            message: x.message,
        });
    }
    return { status: 'ran', targets: pyFiles.length, detail: '--strict --ignore-missing-imports' };
});

await tool('zizmor', () => {
    if (workflowFiles.length === 0) {
        return noTargets('no GitHub workflow/action YAML in scope');
    }
    if (!has('zizmor') && !has('uvx')) {
        return skipped('neither zizmor nor uvx on PATH');
    }
    const runner = has('zizmor') ? ['zizmor'] : ['uvx', 'zizmor'];
    const r = sh(runner[0], [...runner.slice(1), '--offline', '--format', 'json', ...workflowFiles], { cwd: repo });
    if (!r.out.trim().startsWith('[')) {
        throw new Error(`zizmor failed: ${errorSummary(r.err)}`);
    }
    for (const x of JSON.parse(r.out)) {
        const loc = x.locations?.[0];
        add({
            tool: 'zizmor',
            rule: x.ident,
            file: loc?.symbolic?.key?.Local?.verbatim_path ?? null,
            line:
                loc?.concrete?.location?.start_point?.row === undefined
                    ? null
                    : loc.concrete.location.start_point.row + 1,
            severity: String(x.determinations?.severity ?? 'unknown').toLowerCase(),
            message: x.desc,
        });
    }
    return { status: 'ran', targets: workflowFiles.length };
});

const isWorkspace = Boolean(rootPkg?.workspaces) || existsSync(join(repo, 'pnpm-workspace.yaml'));

await tool('sherif', () => {
    if (!isWorkspace) {
        return noTargets('not an npm/pnpm workspace');
    }
    if (!manifestTouched && !opt.all) {
        return noTargets('no package manifest in scope');
    }
    if (!existsSync(BIN('sherif'))) {
        return skipped('toolchain not installed');
    }
    const r = sh(BIN('sherif'), [], { cwd: repo, env: { NO_COLOR: '1' } });
    const text = stripVTControlCharacters(r.out + r.err);
    const readManifest = (path) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), 'utf8') : null);
    for (const issue of parseSherif(text)) {
        for (const { file, line } of sherifLocations(issue, readManifest)) {
            add({ tool: 'sherif', rule: issue.rule, file, line, severity: issue.severity, message: issue.message });
        }
    }
    const n = /across (\d+) packages/.exec(text);
    return { status: 'ran', targets: n ? Number(n[1]) : 1 };
});

await tool('turbo-config', () => {
    const turboFiles = [join(repo, 'turbo.json'), ...readdirSafe(repo)].filter(
        (p, i, a) => existsSync(p) && a.indexOf(p) === i,
    );
    if (!existsSync(join(repo, 'turbo.json'))) {
        return noTargets('no turbo.json');
    }
    if (!manifestTouched && codeFiles.length === 0 && !opt.all) {
        return noTargets('no turbo.json, package manifest or code file in scope');
    }
    /** Each variable read, at its first read in scope. */
    const envRead = new Map();
    for (const f of codeFiles) {
        for (const { name, line } of envReads(readFileSync(join(repo, f), 'utf8'), f)) {
            if (!envRead.has(name)) {
                envRead.set(name, { file: f, line });
            }
        }
    }
    const declared = [];
    for (const path of turboFiles) {
        const cfg = readJson(path);
        const rel = relative(repo, path);
        const text = readFileSync(path, 'utf8');
        if (!cfg) {
            add({
                tool: 'turbo-config',
                rule: 'unparseable-turbo-json',
                file: rel,
                line: jsonSyntaxErrorLine(text),
                severity: 'error',
                message: `${rel} is not valid JSONC, so its tasks were NOT checked`,
            });
            continue;
        }
        declared.push(...(cfg.globalEnv ?? []), ...(cfg.globalPassThroughEnv ?? []));
        const tasksKey = cfg.tasks ? 'tasks' : 'pipeline';
        const lineOf = (task) => jsonKeyLine(text, [tasksKey, task]);
        for (const [task, def] of Object.entries(cfg[tasksKey] ?? {})) {
            const name = task.split('#').pop();
            declared.push(...(def.env ?? []), ...(def.passThroughEnv ?? []));
            if (/^(build|compile|bundle)(:|$)/.test(name) && def.outputs === undefined && def.cache !== false) {
                add({
                    tool: 'turbo-config',
                    rule: 'build-without-outputs',
                    file: rel,
                    line: lineOf(task),
                    severity: 'warning',
                    message: `task "${task}" is cached but declares no outputs — a cache hit restores logs only, not artifacts`,
                });
            }
            if (/^(dev|start|watch|serve)(:|$)/.test(name) && def.cache !== false) {
                add({
                    tool: 'turbo-config',
                    rule: 'persistent-task-cached',
                    file: rel,
                    line: lineOf(task),
                    severity: 'warning',
                    message: `long-running task "${task}" should set "cache": false`,
                });
            }
            if (/^(dev|start|watch|serve)(:|$)/.test(name) && def.persistent !== true) {
                add({
                    tool: 'turbo-config',
                    rule: 'persistent-flag-missing',
                    file: rel,
                    line: lineOf(task),
                    severity: 'warning',
                    message: `long-running task "${task}" should set "persistent": true so nothing can depend on it finishing`,
                });
            }
        }
    }
    const matches = (name) => declared.some((d) => (d.endsWith('*') ? name.startsWith(d.slice(0, -1)) : d === name));
    for (const [name, at] of envRead) {
        if (!matches(name) && !/^(NODE_ENV|CI|VERCEL.*|NEXT_PUBLIC_.*|EXPO_PUBLIC_.*)$/.test(name)) {
            add({
                tool: 'turbo-config',
                rule: 'env-not-in-task-hash',
                file: at.file,
                line: at.line,
                severity: 'warning',
                message: `reads ${name}, which no turbo env/globalEnv/passThroughEnv declares — outputs depending on it can be served from a stale cache (framework-inferred prefixes excluded; first read in scope)`,
            });
        }
    }
    return { status: 'ran', targets: turboFiles.length };
});
function readdirSafe(root) {
    const found = [];
    for (const f of files) {
        if (f.endsWith('/turbo.json')) {
            found.push(join(root, f));
        }
    }
    return found;
}

await tool('turbo-boundaries', () => {
    const turbo = join(repo, 'node_modules/.bin/turbo');
    if (!existsSync(join(repo, 'turbo.json'))) {
        return noTargets('no turbo.json');
    }
    if (!existsSync(turbo)) {
        return skipped('repo has no local turbo binary (run npm install)');
    }
    if (!manifestTouched && codeFiles.length === 0 && !opt.all) {
        return noTargets('no package manifest or code file in scope');
    }
    const r = sh(turbo, ['boundaries'], { cwd: repo, env: { NO_COLOR: '1', FORCE_COLOR: '0' } });
    const text = stripVTControlCharacters(r.out + r.err);
    writeFileSync(join(out, 'turbo-boundaries.txt'), text);
    if (reportedIssueCount(text) === null) {
        // A run with no summary did not complete. Reporting it as skipped or clean is the silent-success class.
        throw new Error(
            `turbo boundaries did not complete (exit ${r.code}): ${text.split('\n').slice(0, 2).join(' ')}`,
        );
    }
    // The ratchet's own reading (boundariesCore.mjs): every finding at the file and line turbo PRINTED, attributed to its
    // workspace; findings in gitignored build output excluded by git's rules; judged against this repository's baseline.
    const report = parseReport(text, workspaceDirs(repo));
    if (report.parsed !== reportedIssueCount(text) || report.unrecognized.length > 0 || report.unmapped.length > 0) {
        throw new Error(
            `turbo boundaries output was not fully read (parsed ${report.parsed} of ${reportedIssueCount(text)}; ${report.unrecognized.length} unknown shape(s); ` +
                `${report.unmapped.length} unattributed) — see turbo-boundaries.txt. Refusing a partial result.`,
        );
    }
    const ownedUnread = report.unparseable.filter((unread) => unread.owned).map((unread) => unread.file);
    const ignoreDecision = gitIgnoredFiles(repo, [...report.findings.map((finding) => finding.file), ...ownedUnread]);
    const ignored = ignoreDecision.ignored ?? new Set();
    const { pairs, counted, skipped } = excludeIgnored(report.findings, ignored);
    const baselinePath = defaultBaselinePath(process.env);
    const baselined = existsSync(baselinePath)
        ? (JSON.parse(readFileSync(baselinePath, 'utf8')).pairs ?? [])
        : undefined;
    const verdict = judgeForGate({
        counted,
        pairs,
        baselined,
        inScope: new Set(opt.all ? counted.map((finding) => finding.file) : files),
    });
    for (const finding of verdict.report) {
        add({
            tool: 'turbo-boundaries',
            rule: finding.rule,
            file: finding.file,
            line: finding.line ?? null,
            severity: 'error',
            // Machine-readable, so scanVerdict.mjs never parses the message to learn a triple is new to the repository.
            newTriple: verdict.ratcheted,
            message: `${finding.package} imports ${finding.dependency} without declaring it${verdict.ratcheted ? ' — NEW: not in the boundaries baseline' : ''}`,
        });
    }
    for (const file of report.unparseable.map((unread) => unread.file).filter((file) => !ignored.has(file))) {
        add({
            tool: 'turbo-boundaries',
            rule: 'unparseable-file',
            file,
            line: null,
            severity: 'error',
            message: 'turbo could not parse this file, so its imports were NOT checked',
        });
    }
    const notes = [
        verdict.ratcheted
            ? `ratchet: ${verdict.report.length} finding(s) in NEW triple(s); ${verdict.baselinedCount} baselined triple(s) not reported`
            : `no boundaries baseline at ${baselinePath} — in-scope findings reported unratcheted; record the backlog with boundariesRatchet.mjs --repo <repo> --update`,
        verdict.stale.length > 0
            ? `${verdict.stale.length} baselined triple(s) STALE — run boundariesRatchet.mjs --update`
            : '',
        skipped.length > 0 ? `${skipped.length} finding(s) in gitignored build output, excluded` : '',
        ignoreDecision.ignored === null ? `git check-ignore failed (${ignoreDecision.error}); nothing excluded` : '',
    ].filter(Boolean);
    return {
        status: 'ran',
        targets: (text.match(/Checked\s+(\d+)/) ?? [])[1] ?? 0,
        detail: `${notes.join('; ')}; raw output in turbo-boundaries.txt`,
    };
});

await tool('knip', () => {
    if (opt.knip === 'off') {
        // ⚠️ ON BY DEFAULT NOW, and both old reasons for switching it off are gone. "Slow: ~15s per
        // workspace" was measured wrong (`--workspace` filters REPORTING, not analysis — one run covers the
        // whole repo in the same ~18s), and the 298 phantom "unused file" findings came from knip GUESSING
        // entry points in a repo that declared none. A repo WITHOUT an entry-point config will still see
        // that noise — if you hit it, write the config rather than passing `--knip off` and losing the tool.
        return skipped('--knip off');
    }
    if (!existsSync(BIN('knip'))) {
        return skipped('toolchain not installed');
    }
    const roots = [...groupByPackage(codeFiles).keys()].filter(Boolean);
    // ⛔ ONE RUN FOR THE WHOLE MONOREPO, THEN FILTER — never one run per workspace. `--workspace` filters
    // knip's REPORTING, not its analysis: it builds the entire module graph either way. Measured on a
    // ~50-workspace monorepo, 2026-09-18: one workspace 18.25s, ALL workspaces 17.75s, and the findings for
    // a given workspace are identical between the two. So the old per-workspace loop paid the same full
    // ~18s graph build N times over for no extra information — which is what made knip look "slow: ~15s per
    // workspace" and got it switched off by default.
    //
    // ⛔ DO NOT "SPEED THIS UP" WITH A PARALLEL POOL OR BY CHUNKING PACKAGES. Both were considered and the
    // measurement refutes them: the cost is fixed startup, not per-package work, so N workers cannot beat
    // one run — and each knip process peaks at ~2.1 GB RSS, so a pool multiplies that into swap or an OOM
    // kill while saving nothing.
    const r = sh(BIN('knip'), ['--reporter', 'json', '--no-progress', '--no-exit-code'], { cwd: repo });
    if (!r.out.trim().startsWith('{')) {
        return {
            status: 'FAILED',
            targets: 0,
            detail: `knip produced no JSON: ${r.err.split('\n').slice(-2).join(' ')}`,
        };
    }
    // ⛔ FILTER TO THE FILES IN SCOPE, NOT THE WORKSPACES THEY LIVE IN. Reporting every unused export in a
    // touched workspace turns a 7-file diff into 115 findings about code the author never opened — the
    // noise that gets a tool switched off. The outer `inScope` set is the same file scope every other tool
    // here reports against, so knip now answers "did THIS change leave something dead?".
    //
    // ⚠️ `--all` (INSPECT) widens that set itself, so a sweep still gets the whole-package view. The
    // whole-repo knip run is unchanged either way: it has to build the full graph to answer at all.
    for (const { kind, file, line, name } of knipFindings(JSON.parse(r.out))) {
        if (!inScope.has(file)) {
            continue;
        }
        add({
            tool: 'knip',
            rule: `unused-or-undeclared:${kind}`,
            file,
            line,
            severity: 'warning',
            message: `${kind}: ${name}`,
        });
    }
    return {
        status: 'ran',
        targets: roots.length || inScope.size,
        detail: `one whole-repo run, findings filtered to the ${inScope.size} file(s) in scope across: ${roots.join(', ') || 'the manifests'}`,
    };
});

await tool('codeql', () => {
    if (opt.codeql === 'off') {
        return skipped('--codeql off');
    }
    if (opt.codeql === 'ci') {
        const gh = (args) => {
            const plain = sh('gh', args, { cwd: repo });
            if (
                plain.code !== 0 &&
                /403|not accessible/i.test(plain.err + plain.out) &&
                existsSync(join(repo, '.envrc')) &&
                has('direnv')
            ) {
                return sh('direnv', ['exec', repo, 'gh', ...args], { cwd: repo });
            }
            return plain;
        };
        // CI checks out a detached merge commit, where `gh pr view` has no branch to resolve: it names the ref itself.
        const pr = process.env['SCQ_CODEQL_REF']
            ? ''
            : gh(['pr', 'view', '--json', 'number,headRefOid', '-q', '.number']).out.trim();
        const ref =
            process.env['SCQ_CODEQL_REF'] ??
            (pr
                ? `refs/pull/${pr}/merge`
                : `refs/heads/${sh('git', ['branch', '--show-current'], { cwd: repo }).out.trim()}`);
        const analyses = gh(['api', `repos/{owner}/{repo}/code-scanning/analyses?ref=${ref}&per_page=20`]);
        if (analyses.code !== 0) {
            return skipped(`code-scanning API unavailable: ${analyses.err.split('\n')[0]}`);
        }
        const list = JSON.parse(analyses.out).filter((a) => a.tool.name === 'CodeQL');
        if (list.length === 0) {
            return noTargets(`no CodeQL analysis published for ${ref}`);
        }
        const alerts = gh([
            'api',
            '--paginate',
            `repos/{owner}/{repo}/code-scanning/alerts?ref=${ref}&state=open&per_page=100`,
        ]);
        const parsed = JSON.parse(
            `[${alerts.out
                .trim()
                .replace(/\]\s*\[/g, ',')
                .replace(/^\[|\]$/g, '')}]`,
        );
        for (const a of parsed) {
            const loc = a.most_recent_instance.location;
            if (!inScope.has(loc.path)) {
                continue;
            }
            add({
                tool: 'codeql',
                rule: a.rule.id,
                file: loc.path,
                line: loc.start_line,
                severity: a.rule.security_severity_level ?? a.rule.severity,
                message: a.most_recent_instance.message.text,
                url: a.html_url,
            });
        }
        const newest = list[0];
        const head = sh('git', ['rev-parse', 'HEAD'], { cwd: repo }).out.trim();
        return {
            status: 'ran',
            targets: list.length,
            detail: `CI analyses for ${ref}; newest ${newest.created_at} on ${newest.commit_sha.slice(0, 8)}${newest.commit_sha === head ? '' : ' (NOT the local HEAD — merge-commit SHA or stale; results may lag local edits)'}`,
        };
    }
    // local
    const cli = has('codeql') ? ['codeql'] : sh('gh', ['codeql', 'version']).code === 0 ? ['gh', 'codeql'] : null;
    if (!cli) {
        return skipped(
            'no codeql CLI (install: gh extension install github/gh-codeql && gh codeql set-version latest)',
        );
    }
    const plans = [];
    const jsRoots = [...groupByPackage(codeFiles).keys()];
    for (const root of jsRoots) {
        plans.push({
            lang: 'javascript-typescript',
            root,
            suite: 'codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls',
        });
    }
    for (const root of [...groupByPackage(pyFiles).keys()]) {
        plans.push({
            lang: 'python',
            root,
            suite: 'codeql/python-queries:codeql-suites/python-security-and-quality.qls',
        });
    }
    if (plans.length === 0) {
        return noTargets('no JS/TS/Python in scope');
    }
    // ⛔ GIVE CODEQL THE MACHINE. Its CLI documents `--threads` as "Defaults to 1", so without this every
    // extraction and every query evaluation runs on ONE core while the rest of the box idles — and this is
    // the longest step in the scan, run once PER PACKAGE ROOT. `0` means one thread per core. `--ram` is a
    // hint, not a cap, and is kept to half of physical memory so a scan cannot push the machine into swap
    // while a test run or an emulator is alive beside it. Neither flag changes which queries run or what
    // they find: same database, same suite, same results — only the wall clock moves.
    const CODEQL_PERF = [`--threads=0`, `--ram=${Math.min(16384, Math.floor(totalmem() / 1024 / 1024 / 2))}`];
    let targets = 0;
    let reused = 0;
    for (const p of plans) {
        // ⛔ THE CACHE KEY IS A CONTENT HASH, AND A DIRTY ROOT IS NEVER CACHED. `database create` is the
        // expensive half, and a GATE runs repeatedly against a tree where most package roots never move — so
        // a root that is clean against HEAD is keyed by its git TREE hash and its database is reused. A root
        // with ANY uncommitted change (the diff under review, always) gets an uncached, `--overwrite` build.
        // ⚠️ This asymmetry is the whole safety argument: a stale database is worse than a slow one, because
        // it reports clean about code it never read — the exact failure this scanner's header warns about.
        // Do NOT "simplify" the key to the root path, and do NOT extend the cache to dirty roots.
        const dirty = sh('git', ['status', '--porcelain', '--', p.root || '.'], { cwd: repo }).out.trim() !== '';
        const treeHash = dirty ? null : sh('git', ['rev-parse', `HEAD:${p.root}`], { cwd: repo }).out.trim() || null;
        const slug = `${p.lang}-${p.root.replaceAll('/', '__') || 'root'}`;
        const db = join(out, 'codeql-db', treeHash ? `${slug}-${treeHash.slice(0, 12)}` : slug);
        // `codeql database create` creates the DB directory but NOT its parents, so without this it dies
        // with "Cannot create database ... because .../codeql-db does not exist". Latent until now only
        // because codeql defaulted to off — the first real run hit it immediately.
        mkdirSync(join(out, 'codeql-db'), { recursive: true });
        const src = join(repo, p.root);
        // The marker is written only AFTER a create returns 0, so a database left half-built by a timeout or
        // a kill is never mistaken for a finished one — `existsSync(db)` alone would do exactly that.
        const built = join(db, '.scq-complete');
        if (treeHash && existsSync(built)) {
            reused++;
        } else {
            const c = sh(
                cli[0],
                [
                    ...cli.slice(1),
                    'database',
                    'create',
                    db,
                    `--language=${p.lang}`,
                    '--build-mode=none',
                    `--source-root=${src}`,
                    '--overwrite',
                    ...CODEQL_PERF,
                ],
                { cwd: repo, timeoutMs: 1_200_000 },
            );
            if (c.code !== 0) {
                throw new Error(
                    `codeql database create failed for ${p.root}: ${c.err.split('\n').slice(-3).join(' ')}`,
                );
            }
            if (treeHash) {
                writeFileSync(built, `${p.lang} ${p.root} ${treeHash}\n`);
            }
        }
        const sarif = `${db}.sarif`;
        // ⛔ ANALYZE RUNS EVERY TIME, EVEN ON A REUSED DATABASE. Only extraction is cached; the query suite
        // is re-evaluated on every scan, so an upgraded CodeQL pack or a changed suite still takes effect.
        const an = sh(
            cli[0],
            [
                ...cli.slice(1),
                'database',
                'analyze',
                db,
                p.suite,
                '--format=sarif-latest',
                `--output=${sarif}`,
                '--download',
                ...CODEQL_PERF,
            ],
            { cwd: repo, timeoutMs: 1_800_000 },
        );
        if (an.code !== 0) {
            throw new Error(`codeql analyze failed for ${p.root}: ${an.err.split('\n').slice(-3).join(' ')}`);
        }
        const s = readJson(sarif);
        const scanned = /scanned (\d+) out of (\d+)/.exec(an.err + an.out);
        targets += scanned ? Number(scanned[1]) : 1;
        for (const r of s.runs[0].results) {
            const loc = r.locations[0].physicalLocation;
            const file = join(p.root, loc.artifactLocation.uri);
            if (!inScope.has(file)) {
                continue;
            }
            add({
                tool: 'codeql',
                rule: r.ruleId,
                file,
                line: loc.region.startLine,
                severity: r.level ?? 'warning',
                message: r.message.text,
            });
        }
    }
    return targets
        ? {
              status: 'ran',
              targets,
              detail: `local CLI, security-and-quality suites; ${plans.length} db(s), ${reused} reused from cache, threads=all`,
          }
        : noTargets('codeql extracted 0 files');
});

// ── write ───────────────────────────────────────────────────────────────────────────────────────────────
const head = sh('git', ['rev-parse', 'HEAD'], { cwd: repo }).out.trim();
writeFileSync(
    join(out, 'findings.jsonl'),
    findings.map((f) => JSON.stringify(f)).join('\n') + (findings.length ? '\n' : ''),
);
writeFileSync(
    join(out, 'status.json'),
    JSON.stringify({ repo, head, mergeBase, scope: scopeLabel, files, kinds, tools: statuses }, null, 2),
);

const byRule = new Map();
for (const f of findings.filter((x) => x.onChangedLine)) {
    const k = `${f.tool}\t${f.rule}`;
    byRule.set(k, (byRule.get(k) ?? 0) + 1);
}
const unlocated = new Map();
for (const f of findings.filter((x) => x.location !== 'line')) {
    const k = `${f.location === 'file' ? 'whole file' : 'workspace-wide'}\t${f.tool}\t${f.rule}`;
    unlocated.set(k, (unlocated.get(k) ?? 0) + 1);
}
const md = [
    `# scan — ${files.length} file(s) in scope (${scopeLabel})`,
    '',
    // ⛔ AN EMPTY SCOPE IS NOT A CLEAN ONE, AND IT NOW HAPPENS BY DEFAULT. With nothing staged and HEAD
    // level with its upstream — the state right after a push — there is no diff to scan, and every tool
    // below truthfully reports NO_TARGETS. That table is indistinguishable from a repo with no problems,
    // which is the exact misreading this scanner's closing warning exists to prevent, so it is said HERE,
    // at the top, where a reader who stops after the heading still sees it.
    ...(files.length === 0
        ? [
              '> ⛔ **NOTHING WAS SCANNED.** The scope resolved to zero files, so NO tool below examined any',
              '> code and this report says nothing about quality. Stage the work, or pass `--base <ref>` /',
              '> `--files <paths>` to name a scope explicitly. Do NOT report this as a pass.',
              '',
          ]
        : []),
    '| tool | status | targets | findings | on changed lines | ms | detail |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...statuses.map(
        (s) =>
            `| ${s.tool} | ${s.status} | ${s.targets} | ${s.findings} | ${s.findingsOnChangedLines} | ${s.durationMs} | ${s.detail.replaceAll('|', '/')} |`,
    ),
    '',
    '## Rules firing on changed lines',
    '',
    ...[...byRule.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${n} × ${k.replace('\t', ' ')}`),
    '',
    '## Findings with no line',
    '',
    '> The tool located these to a whole file (`location: "file"`) or to no file at all (`"package"`) — see findings.jsonl.',
    '> Report them that way; never search a file for a line the tool did not give.',
    '',
    ...[...unlocated.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${n} × ${k.replaceAll('\t', ' ')}`),
    '',
    '> ⚠️ A tool whose status is not `ran` proved NOTHING about this scope. Never report its silence as clean.',
];
writeFileSync(join(out, 'summary.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
