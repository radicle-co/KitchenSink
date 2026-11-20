// gateRun.mjs against a real git repository: plan, record, then a rerun that reuses or narrows. The pure rules are in
// gateLedger.test.mjs; this proves the adapter wires them to git and the artifact layout the workflow uses.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUN = join(dirname(fileURLToPath(import.meta.url)), '..', 'gateRun.mjs');
let root;
let repo;
let base;

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const commitFile = (path, text) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
    git('add', path);
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', `change ${path}`);
    return git('rev-parse', 'HEAD');
};
const node = (...args) =>
    Object.fromEntries(
        execFileSync('node', [RUN, ...args], { encoding: 'utf8' })
            .split('\n')
            .filter(Boolean)
            .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
const plan = (head, ledger, out) =>
    node('plan', '--repo', repo, '--base', base, '--head', head, '--ledger', ledger, '--out', out);
const readPlan = (out) => JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8'));
/** Stores a run's artifact the way the workflow lays the ledger out: one sub-directory per run, oldest first. */
const store = (ledger, name, out) => {
    mkdirSync(join(ledger, name), { recursive: true });
    cpSync(join(out, 'gateVerdict.json'), join(ledger, name, 'gateVerdict.json'));
};
const fresh = (name) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    return dir;
};

describe('gateRun against a git repository', () => {
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gateRun-'));
        repo = join(root, 'repo');
        mkdirSync(repo);
        git('init', '-q', '-b', 'main');
        base = commitFile('README.md', 'base\n');
    });
    after(() => rmSync(root, { recursive: true, force: true }));

    it('judges every changed file on the first run, and gives the judge only those files and their diff', () => {
        commitFile('src/a.ts', 'export const a = 1;\n');
        const head = commitFile('src/b.ts', 'export const b = 1;\n');
        const out = fresh('out1');
        const result = plan(head, fresh('ledger1'), out);
        assert.equal(result.mode, 'judge');
        assert.deepEqual(readPlan(out).toJudge.sort(), ['src/a.ts', 'src/b.ts']);
        const brief = readFileSync(join(out, 'judgeBrief.md'), 'utf8');
        assert.match(brief, /^- src\/a\.ts$/m);
        assert.doesNotMatch(brief, /README\.md/);
        assert.doesNotMatch(readFileSync(join(out, 'changes.diff'), 'utf8'), /README/);
    });

    it('reuses the verdict without a judge when nothing changed, and narrows the rerun to the file that did', () => {
        const head1 = git('rev-parse', 'HEAD');
        const out1 = fresh('out2');
        const ledger = fresh('ledger2');
        plan(head1, ledger, out1);
        const judgeOutput = join(root, 'judge.json');
        writeFileSync(
            judgeOutput,
            JSON.stringify({
                verdict: 'BLOCK',
                findings: [{ severity: 'blocking', file: 'src/a.ts', title: 'bad', detail: 'd' }],
            }),
        );
        const recorded = node('record', '--out', out1, '--sha', head1, '--judge', judgeOutput);
        assert.equal(recorded.state, 'failure');
        store(ledger, '00', out1);

        // A new commit that touches only README (not in the change set's content): src files keep their hashes.
        const head2 = commitFile('docs/n.md', 'note\n');
        const out2 = fresh('out3');
        const rerun = plan(head2, ledger, out2);
        assert.equal(rerun.mode, 'judge');
        assert.deepEqual(readPlan(out2).toJudge, ['docs/n.md']);
        assert.equal(readPlan(out2).carried['src/a.ts'].verdict, 'BLOCK');

        // Judging the doc passes it, yet the unchanged BLOCK on src/a.ts keeps the merged verdict at failure.
        const pass = join(root, 'pass.json');
        writeFileSync(pass, JSON.stringify({ verdict: 'PASS', findings: [] }));
        const merged = node('record', '--out', out2, '--sha', head2, '--judge', pass);
        assert.equal(merged.state, 'failure');
        store(ledger, '01', out2);

        // The same head again: every hash is known, so no model call and the status says where it came from.
        const out3 = fresh('out4');
        const again = plan(head2, ledger, out3);
        assert.equal(again.mode, 'reuse');
        const reused = node('record', '--out', out3, '--sha', head2);
        assert.equal(reused.state, 'failure');
        assert.match(reused.description, /reused from/);
    });

    it('drops a finding the judge raised on a file outside the files it was given', () => {
        const head = commitFile('src/c.ts', 'export const c = 1;\n');
        const out = fresh('out5');
        plan(head, fresh('ledger5'), out);
        const judgeOutput = join(root, 'stray.json');
        writeFileSync(
            judgeOutput,
            JSON.stringify({
                verdict: 'BLOCK',
                findings: [{ severity: 'blocking', file: 'README.md', title: 'old', detail: 'd' }],
            }),
        );
        // The stray blocking finding is dropped, yet the judge said BLOCK: with nothing left to name, every judged file blocks.
        const result = node('record', '--out', out, '--sha', head, '--judge', judgeOutput);
        assert.equal(result.state, 'failure');
        const files = JSON.parse(readFileSync(join(out, 'gateVerdict.json'), 'utf8')).files;
        assert.equal(files['README.md'], undefined);
    });
});
