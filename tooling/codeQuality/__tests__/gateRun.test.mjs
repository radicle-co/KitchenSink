// gateRun.mjs against a real git repository: plan, record, then a rerun that reuses or narrows. The pure rules are in
// gateLedger.test.mjs; this proves the adapter wires them to git and the artifact layout the workflow uses.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

const removeFile = (path) => {
    git('rm', '-q', path);
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', `delete ${path}`);
    return git('rev-parse', 'HEAD');
};

describe('gateRun: deletions and gate-rerun', () => {
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gateRun2-'));
        repo = join(root, 'repo');
        mkdirSync(repo);
        git('init', '-q', '-b', 'main');
        commitFile('README.md', 'base\n');
        commitFile('src/old.ts', 'export const old = 1;\n');
        commitFile('tests/old.test.ts', 'export const t = 1;\n');
        base = commitFile('docs/gone.md', 'gone\n');
    });
    after(() => rmSync(root, { recursive: true, force: true }));

    it('judges a PR that only deletes code or test files, and lists the deleted paths in the brief', () => {
        removeFile('src/old.ts');
        const head = removeFile('docs/gone.md');
        const out = fresh('outD');
        const result = plan(head, fresh('ledgerD'), out);
        assert.equal(result.mode, 'judge');
        const planned = readPlan(out);
        assert.deepEqual(planned.toJudge, ['src/old.ts']);
        assert.deepEqual(planned.deleted, ['src/old.ts']);
        assert.match(readFileSync(join(out, 'judgeBrief.md'), 'utf8'), /^- src\/old\.ts \(deleted\)$/m);
        assert.match(readFileSync(join(out, 'changes.diff'), 'utf8'), /deleted file mode/);
    });

    it('keys a deleted file on a deleted marker, so the verdict is reused at the same head', () => {
        const head = git('rev-parse', 'HEAD');
        const ledger = fresh('ledgerD2');
        const out = fresh('outD2');
        plan(head, ledger, out);
        const pass = join(root, 'passD.json');
        writeFileSync(pass, JSON.stringify({ verdict: 'PASS', findings: [] }));
        assert.equal(node('record', '--out', out, '--sha', head, '--judge', pass).state, 'success');
        store(ledger, '00', out);
        const again = plan(head, ledger, fresh('outD3'));
        assert.equal(again.mode, 'reuse');
    });

    it('re-judges a BLOCKED file on a gate-rerun at the same head, and reuses the PASS ones', () => {
        const head = commitFile('src/a.ts', 'export const a = 1;\n');
        const head2 = commitFile('src/b.ts', 'export const b = 1;\n');
        const ledger = fresh('ledgerR');
        const out = fresh('outR');
        plan(head2, ledger, out);
        const verdict = join(root, 'blockR.json');
        writeFileSync(
            verdict,
            JSON.stringify({
                verdict: 'BLOCK',
                findings: [{ severity: 'blocking', file: './src/a.ts:3', title: 'bad', detail: 'd' }],
            }),
        );
        assert.equal(node('record', '--out', out, '--sha', head2, '--judge', verdict).state, 'failure');
        const files = JSON.parse(readFileSync(join(out, 'gateVerdict.json'), 'utf8')).files;
        assert.equal(files['src/a.ts'].verdict, 'BLOCK');
        assert.equal(files['src/b.ts'].verdict, 'PASS');
        store(ledger, '00', out);
        assert.equal(plan(head2, ledger, fresh('outR2')).mode, 'reuse');
        const rerunOut = fresh('outR3');
        const rerun = node(
            'plan',
            '--repo',
            repo,
            '--base',
            base,
            '--head',
            head2,
            '--ledger',
            ledger,
            '--out',
            rerunOut,
            '--rejudge-blocked',
        );
        assert.equal(rerun.mode, 'judge');
        assert.deepEqual(readPlan(rerunOut).toJudge, ['src/a.ts']);
        assert.equal(head, git('rev-parse', 'HEAD~1'));
    });
});

describe('gateRun: a type change', () => {
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gateRun3-'));
        repo = join(root, 'repo');
        mkdirSync(repo);
        git('init', '-q', '-b', 'main');
        commitFile('src/noop.ts', 'export {};\n');
        base = commitFile('src/guard.ts', 'export const guard = () => { throw new Error("no"); };\n');
    });
    after(() => rmSync(root, { recursive: true, force: true }));

    it('judges a file that a PR turns into a symlink, instead of passing with no judge', () => {
        rmSync(join(repo, 'src/guard.ts'));
        symlinkSync('noop.ts', join(repo, 'src/guard.ts'));
        git('add', 'src/guard.ts');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'guard becomes a symlink');
        const head = git('rev-parse', 'HEAD');
        const out = fresh('outT');
        const result = plan(head, fresh('ledgerT'), out);
        assert.equal(result.mode, 'judge');
        assert.deepEqual(readPlan(out).toJudge, ['src/guard.ts']);
    });
});

describe('gateRun: the base copies of the plan and tasks files the whole PR changes', () => {
    const BASE_TASKS = '- [ ] T1 build the story\n';
    let ledger;
    let afterTaskPush;

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gateRun3-'));
        repo = join(root, 'repo');
        mkdirSync(repo);
        git('init', '-q', '-b', 'main');
        commitFile('README.md', 'base\n');
        base = commitFile('specs/f/tasks.md', BASE_TASKS);
        ledger = fresh('ledgerB');
    });
    after(() => rmSync(root, { recursive: true, force: true }));

    it('keeps listing a tasks file an earlier push changed, with the merge-base text, when a later push judges only code', () => {
        // Push 1 adds a wrap-up task to tasks.md. The judge ran on it and the verdict is in the ledger.
        afterTaskPush = commitFile('specs/f/tasks.md', `${BASE_TASKS}- [ ] T9 wrap-up: end-to-end flows\n`);
        const out1 = fresh('outB1');
        plan(afterTaskPush, ledger, out1);
        const pass = join(root, 'passB.json');
        writeFileSync(pass, JSON.stringify({ verdict: 'PASS', findings: [] }));
        node('record', '--out', out1, '--sha', afterTaskPush, '--judge', pass);
        store(ledger, '00', out1);

        // Push 2 changes only code. tasks.md is unchanged since the verdict, so the judge is not asked about it.
        const head = commitFile('src/code.ts', 'export const code = 1;\n');
        const out2 = fresh('outB2');
        assert.equal(plan(head, ledger, out2).mode, 'judge');
        assert.deepEqual(readPlan(out2).toJudge, ['src/code.ts']);

        const brief = readFileSync(join(out2, 'judgeBrief.md'), 'utf8');
        const basePath = join(out2, 'base', 'specs/f/tasks.md');
        assert.match(brief, /^Plan and tasks files this pull request changes \(whole PR, against the base\):$/m);
        assert.ok(brief.includes(`- specs/f/tasks.md: base copy at ${basePath}`), brief);
        assert.equal(readFileSync(basePath, 'utf8'), BASE_TASKS);
        assert.doesNotMatch(readFileSync(basePath, 'utf8'), /T9/);
    });

    it('says a plan or tasks file that did not exist at the merge base is new in this pull request', () => {
        const head = commitFile('specs/g/tasks.md', '- [ ] T1 something new\n');
        const out = fresh('outB3');
        plan(head, fresh('ledgerB3'), out);

        const brief = readFileSync(join(out, 'judgeBrief.md'), 'utf8');
        assert.match(brief, /^- specs\/g\/tasks\.md: new in this pull request$/m);
        assert.equal(existsSync(join(out, 'base', 'specs/g/tasks.md')), false);
    });

    it('lists no base copies when the pull request changes no plan or tasks file', () => {
        const dir = fresh('repoNone');
        const other = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
        other('init', '-q', '-b', 'main');
        writeFileSync(join(dir, 'a.txt'), 'a\n');
        other('add', 'a.txt');
        other('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'a');
        const root0 = other('rev-parse', 'HEAD');
        mkdirSync(join(dir, 'src'));
        writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
        other('add', 'src/a.ts');
        other('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'b');
        const out = fresh('outB4');
        node(
            'plan',
            '--repo',
            dir,
            '--base',
            root0,
            '--head',
            other('rev-parse', 'HEAD'),
            '--ledger',
            fresh('lB4'),
            '--out',
            out,
        );

        assert.doesNotMatch(readFileSync(join(out, 'judgeBrief.md'), 'utf8'), /Plan and tasks files/);
    });

    it('renders a tasks file the pull request deletes as deleted, with its base copy written for reference', () => {
        const dir = fresh('repoDel');
        const other = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
        other('init', '-q', '-b', 'main');
        mkdirSync(join(dir, 'specs/h'), { recursive: true });
        writeFileSync(join(dir, 'specs/h/tasks.md'), '- [ ] T1 wrap-up\n');
        other('add', 'specs/h/tasks.md');
        other('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'tasks');
        const root0 = other('rev-parse', 'HEAD');
        other('rm', '-q', 'specs/h/tasks.md');
        mkdirSync(join(dir, 'src'));
        writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
        other('add', 'src/a.ts');
        other('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'delete the tasks');
        const out = fresh('outDel');
        node(
            'plan',
            '--repo',
            dir,
            '--base',
            root0,
            '--head',
            other('rev-parse', 'HEAD'),
            '--ledger',
            fresh('lDel'),
            '--out',
            out,
        );

        const brief = readFileSync(join(out, 'judgeBrief.md'), 'utf8');
        assert.match(brief, /^- specs\/h\/tasks\.md: deleted in this pull request, its tasks do not count$/m);
        assert.doesNotMatch(brief, /specs\/h\/tasks\.md: base copy/);
    });

    it('fails the plan on a base that git cannot resolve, and never calls every file new', () => {
        const out = fresh('outBad');

        assert.throws(
            () =>
                execFileSync(
                    'node',
                    [
                        RUN,
                        'plan',
                        '--repo',
                        repo,
                        '--base',
                        'no-such-rev',
                        '--head',
                        'HEAD',
                        '--ledger',
                        fresh('lBad'),
                        '--out',
                        out,
                    ],
                    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
                ),
            (error) => error.status !== 0,
        );
        assert.equal(existsSync(join(out, 'judgeBrief.md')), false);
    });

    it('fails the plan when the base copy cannot be read, so GATE posts a failure and never a pass', () => {
        // The merge-base blob of tasks.md goes missing: git still lists the path, but `git show` cannot read it.
        const blob = git('rev-parse', `${base}:specs/f/tasks.md`);
        rmSync(join(repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2)), { force: true });
        const head = commitFile('src/code2.ts', 'export const code2 = 1;\n');
        const out = fresh('outB5');

        assert.throws(
            () =>
                execFileSync(
                    'node',
                    [RUN, 'plan', '--repo', repo, '--base', base, '--head', head, '--ledger', ledger, '--out', out],
                    {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                    },
                ),
            (error) => error.status !== 0 && /tasks\.md|object/i.test(error.stderr),
        );
    });
});
