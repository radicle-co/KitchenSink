// gateScope.mjs — what the GATE judge is asked to look at (owner ruling 2026-11-20: "We should only run on files that
// change"). Every test fails if the rule it names is removed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isDocFile, judgeMode, renderBrief, scopeFindings } from '../gateScope.mjs';

describe('docs versus code', () => {
    it('reads markdown and plain text as docs and everything else as reviewable code', () => {
        assert.equal(isDocFile('docs/a.md'), true);
        assert.equal(isDocFile('specs/x/spec.mdx'), true);
        assert.equal(isDocFile('notes.txt'), true);
        assert.equal(isDocFile('src/a.ts'), false);
        assert.equal(isDocFile('.github/workflows/gate.yml'), false);
        assert.equal(isDocFile('package.json'), false);
    });

    it('is docs-only when every file to judge is a doc, one run over the doc set', () => {
        assert.equal(judgeMode(['a.md', 'docs/b.md']), 'docs');
    });

    it('is code as soon as one file to judge is not a doc', () => {
        assert.equal(judgeMode(['a.md', 'src/b.ts']), 'code');
    });
});

describe('findings stay inside the judged files', () => {
    const judged = ['src/a.ts', 'src/b.ts'];
    it('drops an ADVISORY finding on a file outside the judged set and says how many', () => {
        const { kept, dropped } = scopeFindings(
            [
                { severity: 'advisory', file: 'src/a.ts', title: 'in' },
                { severity: 'advisory', file: 'src/other.ts', title: 'out' },
            ],
            judged,
        );
        assert.deepEqual(
            kept.map((f) => f.title),
            ['in'],
        );
        assert.equal(dropped, 1);
    });

    it('keeps a BLOCKING finding on an unknown file, with no file, so it blocks every judged file', () => {
        const { kept, dropped } = scopeFindings([{ severity: 'blocking', file: 'src/other.ts', title: 'out' }], judged);
        assert.equal(dropped, 0);
        assert.equal(kept.length, 1);
        assert.equal(kept[0].file, undefined);
        assert.match(kept[0].title, /out/);
        assert.match(kept[0].title, /src\/other\.ts/);
    });

    it('matches a mis-pathed file to the judged file: ./ prefix, :line suffix, repo-root prefix', () => {
        for (const file of [
            './src/b.ts',
            'src/b.ts:12',
            './src/b.ts:12:3',
            '/home/runner/work/r/r/src/b.ts',
            'b/src/b.ts',
        ]) {
            const { kept } = scopeFindings([{ severity: 'blocking', file, title: 't', detail: 'd' }], judged);
            assert.equal(kept[0].file, 'src/b.ts', file);
        }
    });

    it('keeps a finding with no file', () => {
        const { kept, dropped } = scopeFindings([{ severity: 'advisory', title: 'pr-level' }], judged);
        assert.equal(kept.length, 1);
        assert.equal(dropped, 0);
    });
});

describe('the brief names deleted files', () => {
    it('lists each deleted path so the judge can weigh what the deletion removes', () => {
        const brief = renderBrief({ mode: 'code', files: ['src/old.ts'], deleted: ['src/old.ts'], diffPath: '/d' });
        assert.match(brief, /^Deleted files:$/m);
        assert.match(brief, /^- src\/old\.ts \(deleted\)$/m);
    });
});

describe('the brief the judge reads', () => {
    const brief = renderBrief({ mode: 'code', files: ['src/a.ts', 'src/b.ts'], diffPath: '/tmp/x/changes.diff' });

    it('lists every file to judge and names the diff file once', () => {
        assert.match(brief, /^- src\/a\.ts$/m);
        assert.match(brief, /^- src\/b\.ts$/m);
        assert.equal(brief.split('/tmp/x/changes.diff').length - 1, 1);
    });

    it('limits the judge to those files and the changed lines, and forbids findings on unchanged files', () => {
        assert.match(brief, /only these files/i);
        assert.match(brief, /changed lines/i);
        assert.match(brief, /must not raise (a )?finding/i);
        assert.match(brief, /only to understand/i);
    });

    it('asks a docs-only run for a review of the documents, not of the repository', () => {
        const docs = renderBrief({ mode: 'docs', files: ['a.md'], diffPath: '/tmp/x/changes.diff' });
        assert.match(docs, /documentation only/i);
        assert.match(docs, /not a code review/i);
        assert.doesNotMatch(brief, /not a code review/i);
    });
});
