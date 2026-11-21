// The CI GATE's deterministic half: turns scan.mjs output (status.json + findings.jsonl) and the baseline files a PR
// touched into pass or fail.
//
// @pattern Policy — one pure function holds every rule that can fail the `Code quality scanners` check, so the rules
//          are readable and testable in one place and the workflow only moves data in and out.
// @pattern Ratchet — a baseline file may only shrink; growth fails unless the PR carries the `baseline-growth` label.
//
// ⛔ A scanner that analysed nothing reads exactly like a clean codebase. So every required tool must be PRESENT in the
// status, and a tool that did not run over a diff holding targets of its kind is a failure, never a pass.

import { NOT_APPLICABLE, isApplicable } from './scanScope.mjs';

/** The label that allows a PR to grow a baseline file. It waives that one rule and no other. */
export const BASELINE_GROWTH_LABEL = 'baseline-growth';

/**
 * The tools the CI job asks scan.mjs for. A tool missing from the status (dropped from the command, or scan crashed
 * before it) is a failure, because its silence would otherwise read as clean.
 */
export const REQUIRED_TOOLS = [
    'eslint-overlay',
    'semgrep',
    'depcruise',
    'jscpd',
    'knip',
    'sherif',
    'turbo-config',
    'turbo-boundaries',
    'codeql',
];

/**
 * CodeQL's analysis is published by its own workflow and may not exist yet when the scanners run, so for CodeQL alone
 * "no targets" and "skipped" are not failures (its own check is the gate for what it finds). FAILED still is.
 */
const MAY_BE_ABSENT = new Set(['codeql']);

/** Severities that block. scan.mjs keeps each tool's own word: ESLint/Semgrep say `error`, CodeQL says `high`. */
const BLOCKING_SEVERITIES = new Set(['error', 'high', 'critical']);

const place = (finding) =>
    finding.line === null || finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;

/**
 * An array entry without its `why`: the reason annotates debt already on the books, so it is not part of the entry's
 * identity.
 */
const withoutWhy = (entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry;
    }
    return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'why'));
};

/**
 * Every leaf of a baseline file as `path -> count`, so growth is judged per entry (a sum would let one entry rise while
 * another falls). Numbers are their own count, an array entry counts 1 (keyed without its `why`), nested objects
 * recurse. Pure.
 *
 * @param {unknown} json
 * @returns {Map<string, number>}
 */
export function flattenBaseline(json) {
    const flat = new Map();
    const walk = (value, path) => {
        if (typeof value === 'number') {
            flat.set(path, value);
        } else if (Array.isArray(value)) {
            for (const entry of value) {
                flat.set(`${path}/${JSON.stringify(withoutWhy(entry))}`, 1);
            }
        } else if (value !== null && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                walk(child, path === '' ? key : `${path}/${key}`);
            }
        }
    };
    walk(json, '');
    return flat;
}

/** The entries of one baseline file whose count is higher in the PR than at its base (absent counts as 0). Pure. */
function grownEntries({ base, head }) {
    const before = flattenBaseline(base);
    return [...flattenBaseline(head)].filter(([path, count]) => count > (before.get(path) ?? 0)).map(([path]) => path);
}

const toolProblems = (status) => {
    const problems = [];
    const kinds = status.kinds;
    for (const tool of REQUIRED_TOOLS) {
        const entry = status.tools.find((t) => t.tool === tool);
        if (entry === undefined) {
            problems.push(`${tool}: missing from the scan status, so it proved nothing`);
        } else if (entry.status === 'FAILED') {
            problems.push(`${tool}: FAILED${entry.detail ? ` (${entry.detail})` : ''}`);
        } else if (entry.status === NOT_APPLICABLE) {
            // A claim that the diff holds nothing of this tool's kind, re-checked here: it passes only if that is true.
            if (isApplicable(tool, kinds)) {
                problems.push(`${tool}: reported ${NOT_APPLICABLE} although the diff holds files of its kind`);
            }
        } else if (entry.status !== 'ran' && !MAY_BE_ABSENT.has(tool) && isApplicable(tool, kinds)) {
            problems.push(
                `${tool}: ${entry.status} although the diff holds files of its kind${entry.detail ? ` (${entry.detail})` : ''}`,
            );
        }
    }
    return problems;
};

/**
 * The verdict.
 *
 * @param {{
 *   status: {kinds: Record<string, number>, tools: Array<{tool: string, status: string, detail?: string}>},
 *   findings: Array<Record<string, any>>,
 *   baselines: Array<{file: string, base: unknown, head: unknown}>,
 *   labels: string[],
 * }} input
 * @returns {{pass: boolean, violations: Array<{rule: string, message: string, finding?: object}>}}
 */
export function judgeScan({ status, findings, baselines, labels }) {
    const violations = [];

    for (const problem of toolProblems(status)) {
        violations.push({ rule: 'tool-did-not-run', message: problem });
    }

    for (const finding of findings) {
        if (finding.tool === 'turbo-boundaries' && finding.newTriple === true) {
            violations.push({
                rule: 'new-boundaries-triple',
                message: `${place(finding)} [${finding.rule}] ${finding.message}`,
                finding,
            });
        } else if (BLOCKING_SEVERITIES.has(finding.severity) && finding.onChangedLine === true) {
            violations.push({
                rule: 'error-on-changed-line',
                message: `${place(finding)} [${finding.tool}/${finding.rule}] ${finding.message}`,
                finding,
            });
        }
    }

    if (!labels.includes(BASELINE_GROWTH_LABEL)) {
        for (const baseline of baselines) {
            const grown = grownEntries(baseline);
            if (grown.length > 0) {
                violations.push({
                    rule: 'baseline-growth',
                    message: `${baseline.file} grew by ${grown.length} entr${grown.length === 1 ? 'y' : 'ies'}: ${grown.slice(0, 5).join(', ')}${grown.length > 5 ? ', ...' : ''} (label the PR ${BASELINE_GROWTH_LABEL} to allow it)`,
                });
            }
        }
    }

    return { pass: violations.length === 0, violations };
}

/** Workflow-command escaping: `%`, CR and LF would otherwise end or corrupt the annotation. Pure. */
const escapeData = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

/** One `::error` annotation for a finding, at its file and line when it has them. Pure. */
export function formatAnnotation(finding) {
    const where = [
        `file=${finding.file}`,
        ...(finding.line === null || finding.line === undefined ? [] : [`line=${finding.line}`]),
    ].join(',');
    return `::error ${where}::${escapeData(`[${finding.tool}/${finding.rule}] ${finding.message}`)}`;
}

/** The markdown written to the job summary. Pure. */
export function renderSummary({ pass, violations }) {
    return [
        `# Code quality scanners: ${pass ? 'PASS' : 'FAIL'}`,
        '',
        ...(violations.length === 0
            ? ['No blocking violations.']
            : violations.map((v) => `- **${v.rule}**: ${v.message}`)),
        '',
    ].join('\n');
}
