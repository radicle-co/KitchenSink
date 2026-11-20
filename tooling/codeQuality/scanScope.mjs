// Which scanner applies to which changed files, and what each is pointed at (ADR-0097; owner ruling 2026-11-20,
// "We should only run on files that change").
//
// @pattern Policy — pure rules shared by scan.mjs (which runs the tools) and scanVerdict.mjs (which judges that they
//          did), so "this tool has nothing to do" is decided in ONE place and cannot be read two ways.
//
// ⛔ NOT_APPLICABLE is not NO_TARGETS and is not "never ran". NOT_APPLICABLE is a claim that the diff holds no file of
// the tool's kind, and scanVerdict.mjs re-checks the claim against `kinds`; a tool missing from the status still fails.

/** The status of a tool that was not started because the change holds no file of its kind. */
export const NOT_APPLICABLE = 'NOT_APPLICABLE';

/**
 * Per tool: does the change hold anything it can act on? `kinds` counts the changed files of each kind (status.kinds):
 * `code` JS/TS, `python`, `codeInTsProject` code under a package with a tsconfig, `manifest` a package.json /
 * turbo.json / workspace file, `moduleSurface` code whose diff adds or removes an export or import, `workflow` a
 * GitHub workflow or action file.
 */
const APPLICABLE = {
    'eslint-overlay': (k) => k.code > 0,
    'repo-eslint': (k) => k.code > 0,
    semgrep: (k) => k.code + k.python > 0,
    depcruise: (k) => k.codeInTsProject > 0,
    jscpd: (k) => k.code > 0,
    // knip builds the whole module graph, so it only has something to say when an export, an import or a manifest moved.
    knip: (k) => k.moduleSurface > 0 || k.manifest > 0,
    sherif: (k) => k.manifest > 0,
    'turbo-config': (k) => k.manifest > 0 || k.code > 0,
    'turbo-boundaries': (k) => k.manifest > 0 || k.code > 0,
    codeql: (k) => k.code + k.python > 0,
    ruff: (k) => k.python > 0,
    mypy: (k) => k.python > 0,
    zizmor: (k) => k.workflow > 0,
};

/** Whether `tool` has anything to act on in a change described by `kinds`. An unknown tool is never applicable. Pure. */
export function isApplicable(tool, kinds) {
    return APPLICABLE[tool]?.(kinds) ?? false;
}

// An import or export statement or a CommonJS require, at the start of a changed line.
const MODULE_SURFACE_LINE = /^[+-]\s*(export\b|import\b|.*\brequire\()/;

/**
 * Does a `git diff` add or remove an export, an import or a require? Only those can leave something unused or
 * undeclared for knip to report. The `+++`/`---` file headers are not changed lines. Pure.
 *
 * @param {string} diffText
 */
export function touchesModuleSurface(diffText) {
    return diffText
        .split('\n')
        .some((line) => !line.startsWith('+++') && !line.startsWith('---') && MODULE_SURFACE_LINE.test(line));
}

/** The files depcruise is pointed at: the changed files of one package, relative to it. Pure. */
export function cruiseTargets(packageRoot, files) {
    return files.map((f) => (packageRoot === '' ? f : f.slice(packageRoot.length + 1)));
}

/**
 * jscpd compares changed files against the whole repository but reports only a clone that overlaps a changed line.
 * `changedLines` is undefined for a file with no per-line information, where every clone counts. Pure.
 *
 * @param {{start: number, end: number}} range
 * @param {Set<number> | undefined} changedLines
 */
export function cloneTouchesChangedLines({ start, end }, changedLines) {
    if (changedLines === undefined) {
        return true;
    }
    for (let line = start; line <= end; line++) {
        if (changedLines.has(line)) {
            return true;
        }
    }
    return false;
}
