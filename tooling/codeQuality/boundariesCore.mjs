// The workspace-boundaries ratchet's reading of `turbo boundaries`, shared by the ratchet CLI and scan.mjs.
//
// One parser, on purpose. The toolchain used to carry a second, weaker one (`turboBoundariesReport.mjs`) beside a
// repository's copy of this logic; the two disagreed on attribution, on how an escaping import is keyed, and on
// turbo's wrapped continuation lines. This module is now the only place those rules live.
//
// Pure functions are marked Pure; the rest spawn git and say so.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_RULE = 'undeclared-dependency';

/**
 * turbo's own end-of-run summary. `(\d+|no)` because a clean run prints the WORD `no`: a digits-only pattern would
 * reject a burned-down tree as "no summary" forever.
 */
const SUMMARY = /Checked\s+(\d+)\s+files?\s+in\s+(\d+)\s+packages?,\s+(\d+|no)\s+issues?\s+found/;

/** This repository's committed boundaries baseline, beside these scripts — it holds hand-written reasons a cache could lose. */
const BASELINE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'boundariesBaseline.json');

/**
 * How many issues turbo said it found, or `null` when its output carries no summary at all. Pure.
 *
 * @param {string} report
 * @returns {number | null}
 */
export function reportedIssueCount(report) {
    const summary = report.match(SUMMARY);

    return summary === null ? null : summary[3] === 'no' ? 0 : Number(summary[3]);
}

/**
 * Every workspace package's directory paired with its name, longest path first so a nested workspace wins over its
 * parent when both prefix a file path.
 *
 * @param {string} repo - Absolute repository root.
 * @sideEffect Shells out to git and reads manifests from disk.
 * @returns {ReadonlyArray<{dir: string, name: string}>}
 */
export function workspaceDirs(repo) {
    const manifests = execFileSync('git', ['ls-files', '*package.json'], { cwd: repo, encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter((file) => file.length > 0 && !file.includes('node_modules') && !file.includes('prod.package.json'));
    const dirs = [];

    for (const file of manifests) {
        let manifest;

        try {
            manifest = JSON.parse(readFileSync(path.join(repo, file), 'utf8'));
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
 * Which workspace owns an absolute path turbo printed, and that path repo-relative.
 *
 * Matches `/<dir>/` ANYWHERE in the path rather than stripping a checkout root, so nothing depends on where the repo
 * lives or what it is called (GitHub's `/home/runner/work/<repo>/<repo>/…` repeats the name). An unowned path is
 * returned unchanged — still absolute, so a caller must never hand it to git as if it were repo-relative. Pure.
 *
 * @param {string} absolute
 * @param {ReadonlyArray<{dir: string, name: string}>} dirs
 * @returns {{owner: {dir: string, name: string} | undefined, relative: string}}
 */
export function attribute(absolute, dirs) {
    const owner = dirs.find((candidate) => absolute.includes(`/${candidate.dir}/`));

    return { owner, relative: owner === undefined ? absolute : absolute.slice(absolute.indexOf(`/${owner.dir}/`) + 1) };
}

/**
 * Turns a `turbo boundaries` report into one finding per diagnostic — (package, dependency, rule) plus the file and
 * line turbo printed for it, and nothing taken from anywhere else in the text. Pure.
 *
 * Three rule kinds are read: "cannot import package X", "importing from a type declaration package" (the package is
 * taken from the import line and reduced to its root), and "import `X` leaves the package" (keyed on the target
 * resolved REPO-RELATIVE, so one file imported from two directory depths is one key). A file turbo could not READ is
 * returned in `unparseable` as `{file, owned}`, and anything else in `unrecognized`, so a caller can refuse a partial
 * result rather than under-count.
 *
 * @param {string} report
 * @param {ReadonlyArray<{dir: string, name: string}>} dirs
 */
export function parseReport(report, dirs) {
    const findings = [];
    const unmapped = [];
    const unrecognized = [];
    const unparseable = [];

    // turbo WRAPS a long message onto `|`-prefixed continuation lines (`leaves the` / `| package`), so every block is
    // read with those lines joined. Only a bare `|` line is a continuation: a code-frame line carries its line number
    // before the bar (` 52 | …`) and is left alone.
    const blocks = report
        .split(/^\s{2}x\s/m)
        .slice(1)
        .map((block) => block.replace(/\n[ \t]*\|[ \t]+/g, ' '));

    for (const block of blocks) {
        // Not a boundary finding: turbo could not READ the file, so its imports went unchecked. Its own class,
        // because the fix differs from an unknown rule (repair the file, or re-run if it was being written).
        const unreadable = block.match(/^failed to parse file\s+([^\n]*?)(?::\s*[^\n]*)?$/m);

        if (unreadable !== null) {
            const { owner, relative } = attribute(unreadable[1].trim(), dirs);

            unparseable.push({ file: relative, owned: owner !== undefined });
            continue;
        }

        const location = block.match(/,-\[([^:\]]+)(?::(\d+))?/);

        if (location === null) {
            unrecognized.push(block.split('\n')[0]?.trim() ?? '(empty)');
            continue;
        }

        const absolute = location[1];
        const { owner, relative } = attribute(absolute, dirs);

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

            const root = absolute.slice(0, absolute.indexOf(`/${owner.dir}/`) + 1);
            const resolved = path.resolve(path.dirname(absolute), escaping[1]);

            dependency = resolved.startsWith(root) ? resolved.slice(root.length) : resolved;
            rule = 'imports-outside-package';
        } else {
            unrecognized.push(block.split('\n')[0]?.trim() ?? '(empty)');
            continue;
        }

        findings.push({
            package: owner.name,
            dependency,
            rule,
            file: relative,
            line: location[2] === undefined ? null : Number(location[2]),
        });
    }

    return { findings, parsed: blocks.length, unmapped, unrecognized, unparseable };
}

/**
 * Split findings into those that count and those in files git ignores, and derive the counted triples. Pure: the
 * ignore decision is an input.
 *
 * @param {ReadonlyArray<{package: string, dependency: string, rule: string, file: string, line: number | null}>} findings
 * @param {ReadonlySet<string>} ignoredFiles - Repo-relative paths git reports as ignored.
 */
export function excludeIgnored(findings, ignoredFiles) {
    const counted = findings.filter((finding) => !ignoredFiles.has(finding.file));
    const skipped = findings.filter((finding) => ignoredFiles.has(finding.file));
    const seen = new Map(
        counted.map((finding) => [
            `${finding.package} ${finding.dependency} ${finding.rule}`,
            { package: finding.package, dependency: finding.dependency, rule: finding.rule },
        ]),
    );
    const pairs = [...seen.values()].sort(
        (a, b) =>
            a.package.localeCompare(b.package) ||
            a.dependency.localeCompare(b.dependency) ||
            a.rule.localeCompare(b.rule),
    );

    return { pairs, counted, skipped };
}

/**
 * Which of `files` git ignores, by the repository's own rules. Returns `null` when git cannot answer: the check path
 * then counts everything (a broken query may only over-report) and an update refuses to write.
 *
 * @param {string} repo
 * @param {ReadonlyArray<string>} files - Repo-relative paths; they need not exist.
 * @sideEffect Spawns `git check-ignore`.
 * @returns {{ignored: ReadonlySet<string>} | {ignored: null, error: string}}
 */
export function gitIgnoredFiles(repo, files) {
    const unique = [...new Set(files)];

    if (unique.length === 0) {
        return { ignored: new Set() };
    }

    // Exit 0 = some ignored, 1 = none ignored; anything else is git failing, which must not hide findings.
    const child = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
        cwd: repo,
        input: unique.join('\0'),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });

    if (child.status !== 0 && child.status !== 1) {
        return { ignored: null, error: child.stderr?.trim() || `exit ${child.status}` };
    }

    return { ignored: new Set((child.stdout ?? '').split('\0').filter((file) => file.length > 0)) };
}

/**
 * Compare what was reported against what is baselined. An entry with no `rule` is the undeclared-dependency kind. Pure.
 *
 * @param {ReadonlyArray<{package: string, dependency: string, rule?: string}>} reported
 * @param {ReadonlyArray<{package: string, dependency: string, rule?: string}>} baselined
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

/**
 * The reported pairs, each carrying the `why` its baselined entry had. A reason on an entry no longer reported is
 * dropped with it, so a stale exemption cannot outlive what it excused. Pure.
 *
 * @param {ReadonlyArray<{package: string, dependency: string, rule: string}>} pairs
 * @param {ReadonlyArray<{package: string, dependency: string, rule?: string, why?: string}>} existing
 */
export function carryReasons(pairs, existing) {
    const reasons = new Map(
        existing
            .filter((entry) => typeof entry.why === 'string' && entry.why.length > 0)
            .map((entry) => [`${entry.package} ${entry.dependency} ${entry.rule ?? DEFAULT_RULE}`, entry.why]),
    );

    return pairs.map((pair) => {
        const why = reasons.get(`${pair.package} ${pair.dependency} ${pair.rule}`);

        return why === undefined ? pair : { ...pair, why };
    });
}

/**
 * Where the baseline lives: `$SCQ_BOUNDARIES_BASELINE` when set (the suite's seam), else the committed
 * `boundariesBaseline.json` beside these scripts. Pure.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function defaultBaselinePath(env) {
    return env['SCQ_BOUNDARIES_BASELINE'] ?? BASELINE_FILE;
}

/**
 * What a GATE reports from one boundaries run. With a baseline, only a triple it does not hold is a finding, reported at
 * every location turbo gave for it — in scope or not, since it is new to the whole repository. Without one there is
 * nothing to ratchet against, so the findings in scope are reported as they stand. Pure.
 *
 * @param {{counted: ReadonlyArray<{package: string, dependency: string, rule: string, file: string, line: number | null}>, pairs: ReadonlyArray<{package: string, dependency: string, rule: string}>, baselined: ReadonlyArray<{package: string, dependency: string, rule?: string}> | undefined, inScope: ReadonlySet<string>}} input
 */
export function judgeForGate({ counted, pairs, baselined, inScope }) {
    if (baselined === undefined) {
        return {
            report: counted.filter((finding) => inScope.has(finding.file)),
            baselinedCount: 0,
            stale: [],
            ratcheted: false,
        };
    }

    const { added, stale } = decide(pairs, baselined);
    const addedKeys = new Set(added.map((pair) => `${pair.package} ${pair.dependency} ${pair.rule}`));

    return {
        report: counted.filter((finding) => addedKeys.has(`${finding.package} ${finding.dependency} ${finding.rule}`)),
        baselinedCount: pairs.length - added.length,
        stale,
        ratcheted: true,
    };
}
