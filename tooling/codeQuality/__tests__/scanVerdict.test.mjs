// scanVerdict.mjs — the Policy that turns scan.mjs output into pass or fail.
//
// Every test below is written to FAIL if the rule it names is removed or weakened: the pass case beside each fail case
// is what stops a rule from being "always fail". Run with `npm test` in tooling/codeQuality (node:test).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    BASELINE_GROWTH_LABEL,
    REQUIRED_TOOLS,
    flattenBaseline,
    formatAnnotation,
    judgeScan,
    renderSummary,
} from '../scanVerdict.mjs';

const ranTool = (tool) => ({
    tool,
    status: 'ran',
    targets: 3,
    findings: 0,
    findingsOnChangedLines: 0,
    durationMs: 1,
    detail: '',
});
const KINDS = { code: 2, python: 0, codeInTsProject: 2, manifest: 1, moduleSurface: 1, workflow: 0 };
const NO_KINDS = { code: 0, python: 0, codeInTsProject: 0, manifest: 0, moduleSurface: 0, workflow: 0 };

/** A scan in which every required tool ran over a diff that holds targets of every kind, and found nothing. */
const makeStatus = (overrides = {}) => ({
    files: ['a.ts', 'package.json'],
    kinds: KINDS,
    tools: REQUIRED_TOOLS.map(ranTool),
    ...overrides,
});
const withTool = (tool, patch) =>
    REQUIRED_TOOLS.map((name) => (name === tool ? { ...ranTool(name), ...patch } : ranTool(name)));

const makeFinding = (overrides = {}) => ({
    tool: 'eslint-overlay',
    rule: 'sonarjs/cognitive-complexity',
    file: 'a.ts',
    line: 3,
    location: 'line',
    severity: 'error',
    message: 'too complex',
    onChangedLine: true,
    ...overrides,
});

const judge = (input = {}) => judgeScan({ status: makeStatus(), findings: [], baselines: [], labels: [], ...input });
const rules = (verdict) => verdict.violations.map((v) => v.rule);

describe('a clean scan', () => {
    it('passes', () => {
        const verdict = judge();
        assert.equal(verdict.pass, true);
        assert.deepEqual(verdict.violations, []);
    });
});

describe('error-severity findings on a changed line', () => {
    it('fail the scan and name the file, line, tool and rule', () => {
        const verdict = judge({ findings: [makeFinding()] });
        assert.equal(verdict.pass, false);
        assert.deepEqual(rules(verdict), ['error-on-changed-line']);
        assert.match(verdict.violations[0].message, /a\.ts:3/);
        assert.match(verdict.violations[0].message, /eslint-overlay/);
        assert.match(verdict.violations[0].message, /sonarjs\/cognitive-complexity/);
    });

    it('do not fail the scan when the line was not changed by the PR', () => {
        assert.equal(judge({ findings: [makeFinding({ onChangedLine: false })] }).pass, true);
    });

    it('do not fail the scan when they are only warnings', () => {
        assert.equal(judge({ findings: [makeFinding({ severity: 'warning' })] }).pass, true);
    });

    it('count high and critical severities too (CodeQL reports them instead of "error")', () => {
        assert.equal(judge({ findings: [makeFinding({ tool: 'codeql', severity: 'high' })] }).pass, false);
        assert.equal(judge({ findings: [makeFinding({ tool: 'codeql', severity: 'critical' })] }).pass, false);
        assert.equal(judge({ findings: [makeFinding({ tool: 'codeql', severity: 'medium' })] }).pass, true);
    });

    it('count a whole-file error on a changed file (it has no line but its file is in the diff)', () => {
        const verdict = judge({ findings: [makeFinding({ location: 'file', line: null })] });
        assert.deepEqual(rules(verdict), ['error-on-changed-line']);
    });

    it('report every offender, not just the first', () => {
        const verdict = judge({ findings: [makeFinding({ line: 1 }), makeFinding({ line: 2 })] });
        assert.equal(verdict.violations.length, 2);
    });
});

describe('a scanner that did not run', () => {
    it('fails the scan when a tool FAILED, naming the tool and why', () => {
        const verdict = judge({
            status: makeStatus({
                tools: withTool('semgrep', { status: 'FAILED', detail: 'rules download timed out' }),
            }),
        });
        assert.deepEqual(rules(verdict), ['tool-did-not-run']);
        assert.match(verdict.violations[0].message, /semgrep/);
        assert.match(verdict.violations[0].message, /rules download timed out/);
    });

    it('fails the scan on NO_TARGETS when the diff holds targets of that tool kind', () => {
        const verdict = judge({
            status: makeStatus({ tools: withTool('eslint-overlay', { status: 'NO_TARGETS', targets: 0 }) }),
        });
        assert.deepEqual(rules(verdict), ['tool-did-not-run']);
    });

    it('fails the scan on SKIPPED when the diff holds targets of that tool kind', () => {
        const verdict = judge({ status: makeStatus({ tools: withTool('jscpd', { status: 'SKIPPED', targets: 0 }) }) });
        assert.deepEqual(rules(verdict), ['tool-did-not-run']);
    });

    it('allows NO_TARGETS when the diff holds no targets of that tool kind', () => {
        const status = makeStatus({
            files: ['docs/readme.md'],
            kinds: NO_KINDS,
            tools: REQUIRED_TOOLS.map((tool) => ({ ...ranTool(tool), status: 'NO_TARGETS', targets: 0 })),
        });
        assert.equal(judge({ status }).pass, true);
    });

    for (const [tool, kinds] of [
        ['eslint-overlay', { ...NO_KINDS, code: 1 }],
        ['jscpd', { ...NO_KINDS, code: 1 }],
        ['semgrep', { ...NO_KINDS, python: 1 }],
        ['depcruise', { ...NO_KINDS, codeInTsProject: 1 }],
        ['knip', { ...NO_KINDS, moduleSurface: 1 }],
        ['sherif', { ...NO_KINDS, manifest: 1 }],
        ['turbo-config', { ...NO_KINDS, manifest: 1 }],
        ['turbo-boundaries', { ...NO_KINDS, code: 1 }],
    ]) {
        it(`expects ${tool} to run when its own kind of target is in the diff`, () => {
            const status = makeStatus({ kinds, tools: withTool(tool, { status: 'NO_TARGETS', targets: 0 }) });
            assert.deepEqual(rules(judge({ status })), ['tool-did-not-run']);
        });
    }

    it('passes a tool that reports NOT_APPLICABLE when the diff holds none of its kind', () => {
        const status = makeStatus({
            files: ['docs/readme.md'],
            kinds: NO_KINDS,
            tools: REQUIRED_TOOLS.map((tool) => ({ ...ranTool(tool), status: 'NOT_APPLICABLE', targets: 0 })),
        });
        assert.equal(judge({ status }).pass, true);
    });

    it('fails a tool that claims NOT_APPLICABLE although the diff holds files of its kind', () => {
        const status = makeStatus({ tools: withTool('eslint-overlay', { status: 'NOT_APPLICABLE', targets: 0 }) });
        const verdict = judge({ status });
        assert.deepEqual(rules(verdict), ['tool-did-not-run']);
        assert.match(verdict.violations[0].message, /eslint-overlay/);
    });

    it('does not read NOT_APPLICABLE as never-ran: a tool absent from the status still fails on a docs-only diff', () => {
        const status = makeStatus({
            files: ['docs/readme.md'],
            kinds: NO_KINDS,
            tools: REQUIRED_TOOLS.filter((tool) => tool !== 'knip').map((tool) => ({
                ...ranTool(tool),
                status: 'NOT_APPLICABLE',
            })),
        });
        const verdict = judge({ status });
        assert.deepEqual(rules(verdict), ['tool-did-not-run']);
        assert.match(verdict.violations[0].message, /knip/);
    });

    it('does not expect knip to run for a code change with no export, import or manifest change', () => {
        const kinds = { ...NO_KINDS, code: 1, codeInTsProject: 1 };
        const status = makeStatus({ kinds, tools: withTool('knip', { status: 'NOT_APPLICABLE', targets: 0 }) });
        assert.equal(judge({ status }).pass, true);
    });

    it('fails the scan when a required tool is missing from the status altogether', () => {
        const status = makeStatus({ tools: REQUIRED_TOOLS.filter((tool) => tool !== 'depcruise').map(ranTool) });
        const verdict = judge({ status });
        assert.deepEqual(rules(verdict), ['tool-did-not-run']);
        assert.match(verdict.violations[0].message, /depcruise/);
    });

    it('lets CodeQL be NO_TARGETS or SKIPPED (its analysis is published by its own workflow), but not FAILED', () => {
        assert.equal(
            judge({ status: makeStatus({ tools: withTool('codeql', { status: 'NO_TARGETS', targets: 0 }) }) }).pass,
            true,
        );
        assert.equal(
            judge({ status: makeStatus({ tools: withTool('codeql', { status: 'SKIPPED', targets: 0 }) }) }).pass,
            true,
        );
        assert.equal(judge({ status: makeStatus({ tools: withTool('codeql', { status: 'FAILED' }) }) }).pass, false);
    });
});

describe('the boundaries ratchet', () => {
    it('fails the scan on a triple that is new to the repository, even when its line is untouched', () => {
        const finding = makeFinding({
            tool: 'turbo-boundaries',
            rule: 'undeclared-dependency',
            newTriple: true,
            onChangedLine: false,
        });
        assert.deepEqual(rules(judge({ findings: [finding] })), ['new-boundaries-triple']);
    });

    it('does not fail the scan on a baselined triple off the changed lines', () => {
        const finding = makeFinding({
            tool: 'turbo-boundaries',
            rule: 'undeclared-dependency',
            newTriple: false,
            onChangedLine: false,
        });
        assert.equal(judge({ findings: [finding] }).pass, true);
    });

    it('does not report one new triple twice when it is also an error on a changed line', () => {
        const finding = makeFinding({ tool: 'turbo-boundaries', newTriple: true, onChangedLine: true });
        assert.deepEqual(rules(judge({ findings: [finding] })), ['new-boundaries-triple']);
    });
});

describe('baseline growth', () => {
    const counts = (files) => ({ files });
    const growth = (base, head) => ({
        file: 'packages/tools/repoGuards/__tests__/nativeStylingBaseline.json',
        base,
        head,
    });

    it('fails the scan when a recorded count goes up', () => {
        const verdict = judge({ baselines: [growth(counts({ 'a.ts': 2 }), counts({ 'a.ts': 3 }))] });
        assert.deepEqual(rules(verdict), ['baseline-growth']);
        assert.match(verdict.violations[0].message, /nativeStylingBaseline\.json/);
        assert.match(verdict.violations[0].message, /a\.ts/);
    });

    it('fails the scan when an entry is added', () => {
        assert.equal(
            judge({ baselines: [growth(counts({ 'a.ts': 2 }), counts({ 'a.ts': 2, 'b.ts': 1 }))] }).pass,
            false,
        );
    });

    it('fails the scan when a baseline file is created holding entries', () => {
        assert.equal(judge({ baselines: [growth(null, counts({ 'a.ts': 1 }))] }).pass, false);
    });

    it('fails the scan when one count falls and another rises (the sum alone would hide it)', () => {
        const verdict = judge({
            baselines: [growth(counts({ 'a.ts': 5, 'b.ts': 1 }), counts({ 'a.ts': 1, 'b.ts': 2 }))],
        });
        assert.equal(verdict.pass, false);
    });

    it('fails the scan when an array baseline gains an entry', () => {
        const pair = (dependency) => ({ package: '@x/y', dependency, rule: 'undeclared-dependency' });
        assert.equal(
            judge({ baselines: [growth({ pairs: [pair('a')] }, { pairs: [pair('a'), pair('b')] })] }).pass,
            false,
        );
    });

    // A `why` explains debt that is already on the books. Keying an entry with it made every annotation read as a new
    // entry, so the ratchet punished exactly the reason it asks for.
    describe('a `why` on an array entry', () => {
        const pair = (dependency, why) => ({
            package: '@x/y',
            dependency,
            rule: 'imports-outside-package',
            ...(why === undefined ? {} : { why }),
        });
        const grew = (base, head) => !judge({ baselines: [growth({ pairs: base }, { pairs: head })] }).pass;

        it('is not growth when it is added to an existing pair', () => {
            assert.equal(grew([pair('a')], [pair('a', 'bootstraps the install')]), false);
        });

        it('is not growth when it is changed on an existing pair', () => {
            assert.equal(grew([pair('a', 'old reason')], [pair('a', 'new reason')]), false);
        });

        it('is growth for a new pair, with or without a `why`', () => {
            assert.equal(grew([pair('a')], [pair('a'), pair('b')]), true);
            assert.equal(grew([pair('a')], [pair('a'), pair('b', 'a reason')]), true);
        });

        it('is a shrink when the pair is removed', () => {
            assert.equal(grew([pair('a', 'a reason'), pair('b')], [pair('b')]), false);
        });
    });

    it('passes when a baseline shrinks, is unchanged or is deleted', () => {
        assert.equal(judge({ baselines: [growth(counts({ 'a.ts': 3 }), counts({ 'a.ts': 2 }))] }).pass, true);
        assert.equal(judge({ baselines: [growth(counts({ 'a.ts': 3 }), counts({ 'a.ts': 3 }))] }).pass, true);
        assert.equal(judge({ baselines: [growth(counts({ 'a.ts': 3 }), null)] }).pass, true);
        assert.equal(judge({ baselines: [growth({}, {})] }).pass, true);
    });

    it('is allowed by the baseline-growth label, and only that label', () => {
        const baselines = [growth(counts({ 'a.ts': 2 }), counts({ 'a.ts': 3 }))];
        assert.equal(judge({ baselines, labels: [BASELINE_GROWTH_LABEL] }).pass, true);
        assert.equal(judge({ baselines, labels: ['ai-review', 'heavy-e2e'] }).pass, false);
    });

    it('is the only rule the label waives', () => {
        const baselines = [growth(counts({ 'a.ts': 2 }), counts({ 'a.ts': 3 }))];
        const verdict = judge({ baselines, labels: [BASELINE_GROWTH_LABEL], findings: [makeFinding()] });
        assert.deepEqual(rules(verdict), ['error-on-changed-line']);
    });
});

describe('flattenBaseline', () => {
    it('reads count maps, entry arrays and the empty object', () => {
        assert.deepEqual([...flattenBaseline({ files: { 'a.ts': 4 } })], [['files/a.ts', 4]]);
        assert.deepEqual([...flattenBaseline({})], []);
        assert.deepEqual([...flattenBaseline(null)], []);
        const flat = flattenBaseline({ pairs: [{ package: 'p', dependency: 'd', rule: 'r' }] });
        assert.deepEqual([...flat.values()], [1]);
        assert.equal(flat.size, 1);
    });
});

describe('reporting', () => {
    it('formats a GitHub annotation with the location, tool and rule, and escapes the message', () => {
        const line = formatAnnotation(makeFinding({ message: '50% done\nnext' }));
        assert.equal(line, '::error file=a.ts,line=3::[eslint-overlay/sonarjs/cognitive-complexity] 50%25 done%0Anext');
    });

    it('leaves the line out of the annotation of a whole-file finding', () => {
        assert.match(formatAnnotation(makeFinding({ line: null, location: 'file' })), /^::error file=a\.ts::/);
    });

    it('renders every violation in the summary, and says PASS only when there are none', () => {
        const failing = renderSummary(judge({ findings: [makeFinding()] }));
        assert.match(failing, /FAIL/);
        assert.match(failing, /error-on-changed-line/);
        assert.match(renderSummary(judge()), /PASS/);
        assert.doesNotMatch(renderSummary(judge()), /FAIL/);
    });
});
