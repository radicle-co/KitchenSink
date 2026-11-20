// gateLedger.mjs — per-file GATE verdicts, their reuse and their merge. Every test fails if the rule it names is
// removed. A record is what one GATE run stores as the artifact `gate-<sha>`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildRecord,
    describeOutcome,
    foldLedger,
    mergeVerdicts,
    parseRecord,
    perFileVerdicts,
    planRun,
    renderReview,
} from '../gateLedger.mjs';

const entry = (hash, verdict, findings = []) => ({ hash, verdict, findings });
const record = (sha, files) => ({ sha, files });
const hashes = (o) => new Map(Object.entries(o));

describe('perFileVerdicts', () => {
    it('blocks only the files that carry a blocking finding', () => {
        const v = perFileVerdicts({
            judged: new Map([
                ['a.ts', 'h1'],
                ['b.ts', 'h2'],
            ]),
            verdict: 'BLOCK',
            findings: [{ severity: 'blocking', file: 'a.ts', title: 't', detail: 'd' }],
        });
        assert.equal(v['a.ts'].verdict, 'BLOCK');
        assert.equal(v['b.ts'].verdict, 'PASS');
        assert.equal(v['a.ts'].hash, 'h1');
    });

    it('blocks every judged file for a blocking finding that names no file', () => {
        const v = perFileVerdicts({
            judged: new Map([
                ['a.ts', 'h1'],
                ['b.ts', 'h2'],
            ]),
            verdict: 'BLOCK',
            findings: [{ severity: 'blocking', title: 'pr-level', detail: 'd' }],
        });
        assert.equal(v['a.ts'].verdict, 'BLOCK');
        assert.equal(v['b.ts'].verdict, 'BLOCK');
    });

    it('blocks every judged file when the judge says BLOCK with no blocking finding at all', () => {
        const v = perFileVerdicts({ judged: new Map([['a.ts', 'h1']]), verdict: 'BLOCK', findings: [] });
        assert.equal(v['a.ts'].verdict, 'BLOCK');
    });

    it('passes a file whose only findings are advisory', () => {
        const v = perFileVerdicts({
            judged: new Map([['a.ts', 'h1']]),
            verdict: 'PASS',
            findings: [{ severity: 'advisory', file: 'a.ts', title: 't', detail: 'd' }],
        });
        assert.equal(v['a.ts'].verdict, 'PASS');
        assert.equal(v['a.ts'].findings.length, 1);
    });
});

describe('planRun: reuse and the rerun scope', () => {
    const ledger = foldLedger([record('s1', { 'a.ts': entry('A1', 'PASS'), 'b.ts': entry('B1', 'PASS') })]);

    it('reuses the earlier verdict, naming its sha, when every changed file has the same hash', () => {
        const plan = planRun({ changed: hashes({ 'a.ts': 'A1', 'b.ts': 'B1' }), ledger });
        assert.equal(plan.reuse, true);
        assert.deepEqual(plan.toJudge, []);
        assert.equal(plan.reusedFrom, 's1');
    });

    it('judges only the files whose content changed since the last verdict', () => {
        const plan = planRun({ changed: hashes({ 'a.ts': 'A2', 'b.ts': 'B1' }), ledger });
        assert.equal(plan.reuse, false);
        assert.deepEqual(plan.toJudge, ['a.ts']);
        assert.equal(plan.carried['b.ts'].hash, 'B1');
    });

    it('judges a file new to the PR', () => {
        const plan = planRun({ changed: hashes({ 'a.ts': 'A1', 'c.ts': 'C1' }), ledger });
        assert.deepEqual(plan.toJudge, ['c.ts']);
    });

    it('judges everything when there is no earlier verdict', () => {
        const plan = planRun({ changed: hashes({ 'a.ts': 'A1' }), ledger: foldLedger([]) });
        assert.deepEqual(plan.toJudge, ['a.ts']);
        assert.equal(plan.reuse, false);
    });

    it('does not carry a verdict for a file that has left the PR', () => {
        const plan = planRun({ changed: hashes({ 'a.ts': 'A1' }), ledger });
        assert.deepEqual(Object.keys(plan.carried), ['a.ts']);
        assert.equal(plan.reuse, true);
    });

    it('reuses an earlier verdict when a file returns to a content hash that was judged before', () => {
        const folded = foldLedger([
            record('s1', { 'a.ts': entry('A1', 'PASS') }),
            record('s2', { 'a.ts': entry('A2', 'BLOCK') }),
        ]);
        const plan = planRun({ changed: hashes({ 'a.ts': 'A1' }), ledger: folded });
        assert.equal(plan.reuse, true);
        assert.equal(plan.reusedFrom, 's1');
    });

    it('names the newest record among the ones it reused from, whatever order the files come in', () => {
        const folded = foldLedger([
            record('s1', { 'a.ts': entry('A1', 'PASS') }),
            record('s2', { 'b.ts': entry('B1', 'PASS') }),
        ]);
        assert.equal(planRun({ changed: hashes({ 'b.ts': 'B1', 'a.ts': 'A1' }), ledger: folded }).reusedFrom, 's2');
        assert.equal(planRun({ changed: hashes({ 'a.ts': 'A1', 'b.ts': 'B1' }), ledger: folded }).reusedFrom, 's2');
    });

    it('treats the same path with a different hash as a different file', () => {
        const plan = planRun({ changed: hashes({ 'a.ts': 'A9' }), ledger });
        assert.deepEqual(plan.toJudge, ['a.ts']);
    });

    it('lets the newest record win when two records hold the same path and hash', () => {
        const folded = foldLedger([
            record('s1', { 'a.ts': entry('A1', 'PASS') }),
            record('s2', { 'a.ts': entry('A1', 'BLOCK') }),
        ]);
        const plan = planRun({ changed: hashes({ 'a.ts': 'A1' }), ledger: folded });
        assert.equal(plan.carried['a.ts'].verdict, 'BLOCK');
        assert.equal(plan.reusedFrom, 's2');
    });
});

describe('a BLOCK on an unchanged file persists', () => {
    it('carries the BLOCK while the file is unchanged, and the merged verdict stays BLOCK', () => {
        const ledger = foldLedger([
            record('s1', { 'a.ts': entry('A1', 'BLOCK', [{ severity: 'blocking', file: 'a.ts', title: 'bad' }]) }),
        ]);
        const plan = planRun({ changed: hashes({ 'a.ts': 'A1', 'b.ts': 'B1' }), ledger });
        assert.equal(plan.carried['a.ts'].verdict, 'BLOCK');
        assert.deepEqual(plan.toJudge, ['b.ts']);
        const files = {
            ...plan.carried,
            ...perFileVerdicts({ judged: new Map([['b.ts', 'B1']]), verdict: 'PASS', findings: [] }),
        };
        assert.equal(mergeVerdicts(files).verdict, 'BLOCK');
    });

    it('clears the BLOCK once the file changes and its new content passes', () => {
        const ledger = foldLedger([record('s1', { 'a.ts': entry('A1', 'BLOCK') })]);
        const plan = planRun({ changed: hashes({ 'a.ts': 'A2' }), ledger });
        assert.deepEqual(plan.toJudge, ['a.ts']);
        const files = perFileVerdicts({ judged: new Map([['a.ts', 'A2']]), verdict: 'PASS', findings: [] });
        assert.equal(mergeVerdicts(files).verdict, 'PASS');
    });
});

describe('mergeVerdicts', () => {
    it('is BLOCK if any file is BLOCK and names the blocked files', () => {
        const m = mergeVerdicts({
            'a.ts': entry('1', 'PASS'),
            'b.ts': entry('2', 'BLOCK'),
            'c.ts': entry('3', 'PASS'),
        });
        assert.equal(m.verdict, 'BLOCK');
        assert.deepEqual(m.blocked, ['b.ts']);
    });

    it('is PASS when every file passes', () => {
        assert.equal(mergeVerdicts({ 'a.ts': entry('1', 'PASS') }).verdict, 'PASS');
    });

    it('is PASS for an empty change set', () => {
        assert.equal(mergeVerdicts({}).verdict, 'PASS');
    });
});

describe('buildRecord and describeOutcome', () => {
    it('stores the carried and the newly judged files under the sha', () => {
        const r = buildRecord({
            sha: 'abc',
            carried: { 'a.ts': entry('A1', 'PASS') },
            judged: { 'b.ts': entry('B1', 'PASS') },
        });
        assert.equal(r.sha, 'abc');
        assert.deepEqual(Object.keys(r.files).sort(), ['a.ts', 'b.ts']);
    });

    it('says "reused from <sha>" and does not claim a model call when nothing was judged', () => {
        const text = describeOutcome({ verdict: 'PASS', blocked: [] }, { reusedFrom: 's1234567890', judgedCount: 0 });
        assert.match(text.description, /reused from s123456/);
    });

    it('fails the status on BLOCK and names how many files are blocked', () => {
        const text = describeOutcome({ verdict: 'BLOCK', blocked: ['a.ts', 'b.ts'] }, { judgedCount: 1 });
        assert.equal(text.state, 'failure');
        assert.match(text.description, /2 file/);
    });

    it('succeeds the status on PASS', () => {
        assert.equal(describeOutcome({ verdict: 'PASS', blocked: [] }, { judgedCount: 1 }).state, 'success');
    });

    it('keeps the status description within the 140 characters GitHub allows', () => {
        const blocked = Array.from({ length: 500 }, (_, i) => `f${i}.ts`);
        assert.ok(describeOutcome({ verdict: 'BLOCK', blocked }, { judgedCount: 1 }).description.length <= 140);
    });
});

describe('parseRecord', () => {
    it('accepts a well-formed record', () => {
        const r = parseRecord(JSON.stringify(record('s1', { 'a.ts': entry('A1', 'PASS') })));
        assert.equal(r.sha, 's1');
    });
    it('refuses malformed JSON, a missing hash and an unknown verdict, so the file is judged again', () => {
        assert.equal(parseRecord('{nope'), null);
        assert.equal(
            parseRecord(JSON.stringify({ sha: 's', files: { 'a.ts': { verdict: 'PASS', findings: [] } } })),
            null,
        );
        assert.equal(parseRecord(JSON.stringify(record('s', { 'a.ts': entry('A1', 'MAYBE') }))), null);
        assert.equal(parseRecord(JSON.stringify({ files: {} })), null);
    });
});

describe('renderReview', () => {
    it('names each blocked file and its blocking finding', () => {
        const body = renderReview({
            'a.ts': entry('A1', 'BLOCK', [
                { severity: 'blocking', file: 'a.ts', line: 4, title: 'ref in render', detail: 'why' },
            ]),
            'b.ts': entry('B1', 'PASS'),
        });
        assert.match(body, /a\.ts:4/);
        assert.match(body, /ref in render/);
        assert.doesNotMatch(body, /b\.ts/);
    });
});
