import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { chooseBaseline, driftVerdict, parseMarker, planCanvas, publishInput, publishLabel } from '../publishPlan.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const oid = (n: number): string => n.toString(16).padStart(40, '0');

const tree = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries));

describe('chooseBaseline', () => {
    it('uses the marker when the live canvas carries one', () => {
        expect(chooseBaseline(SHA_A, SHA_B)).toEqual({ sha: SHA_A, from: 'marker' });
    });

    it('falls back to the snapshot commit when there is no marker', () => {
        expect(chooseBaseline(null, SHA_B)).toEqual({ sha: SHA_B, from: 'snapshot' });
    });
});

describe('parseMarker', () => {
    it('reads a marker that holds one full sha', () => {
        expect(parseMarker(JSON.stringify({ sha: SHA_A }))).toBe(SHA_A);
    });

    it.each([
        ['not json', '{'],
        ['a short sha', JSON.stringify({ sha: 'abc' })],
        ['an uppercase sha', JSON.stringify({ sha: 'A'.repeat(40) })],
        ['an extra key', JSON.stringify({ sha: SHA_A, extra: 1 })],
        ['no sha', JSON.stringify({})],
    ])('rejects %s with invalid-marker', (_name, text) => {
        let caught: unknown;

        try {
            parseMarker(text);
        } catch (error) {
            caught = error;
        }

        expect(isDesignArtifactError(caught) && caught.code).toBe('invalid-marker');
    });
});

describe('planCanvas', () => {
    const base = tree({ 'project/a.html': oid(1), 'project/b.html': oid(2), 'project/canvas.json': oid(3) });

    it('reports no change when the trees match', () => {
        const plan = planCanvas({ baseline: base, main: new Map(base), from: 'marker' });

        expect(plan).toMatchObject({ status: 'unchanged', changed: [], deleted: [], download: [] });
    });

    it('lists a changed, an added and a deleted path, sorted, and downloads just those from a marker', () => {
        const main = tree({
            'project/a.html': oid(9),
            'project/z.html': oid(4),
            'project/canvas.json': oid(3),
        });
        const plan = planCanvas({ baseline: base, main, from: 'marker' });

        expect(plan.status).toBe('publish');
        expect(plan.changed).toEqual(['project/a.html', 'project/z.html']);
        expect(plan.deleted).toEqual(['project/b.html']);
        expect(plan.download).toEqual(['project/a.html', 'project/b.html', 'project/z.html']);
        expect(plan.expected['project/a.html']).toEqual({ baseline: oid(1), main: oid(9) });
        expect(plan.expected['project/z.html']).toEqual({ baseline: null, main: oid(4) });
        expect(plan.expected['project/b.html']).toEqual({ baseline: oid(2), main: null });
    });

    it('downloads every baseline path when the baseline is the snapshot', () => {
        const main = tree({ 'project/a.html': oid(9), 'project/b.html': oid(2), 'project/canvas.json': oid(3) });
        const plan = planCanvas({ baseline: base, main, from: 'snapshot' });

        expect(plan.changed).toEqual(['project/a.html']);
        expect(plan.download).toEqual(['project/a.html', 'project/b.html', 'project/canvas.json']);
    });

    it('treats a rename as a delete plus an add', () => {
        const main = tree({ 'project/a.html': oid(1), 'project/c.html': oid(2), 'project/canvas.json': oid(3) });
        const plan = planCanvas({ baseline: base, main, from: 'marker' });

        expect(plan.deleted).toEqual(['project/b.html']);
        expect(plan.changed).toEqual(['project/c.html']);
    });

    it('never lists snapshot.json, the marker or anything outside project/', () => {
        const baseline = tree({ 'project/a.html': oid(1) });
        const main = tree({
            'project/a.html': oid(1),
            'snapshot.json': oid(7),
            'project/published.json': oid(8),
            'artifact-type/x.js': oid(5),
            'index.html': oid(6),
        });
        const plan = planCanvas({ baseline, main, from: 'marker' });

        expect(plan.status).toBe('unchanged');
        expect(Object.keys(plan.expected)).toEqual(['project/a.html']);
    });

    // Replaces "lists no download when nothing changed even from the snapshot": the live canvas has never been
    // compared with the repo, so an unchanged plan from the snapshot must still download every baseline path to
    // prove the live files match before the marker is written.
    it('downloads every baseline path from the snapshot even when nothing changed', () => {
        const plan = planCanvas({ baseline: base, main: new Map(base), from: 'snapshot' });

        expect(plan.status).toBe('unchanged');
        expect(plan.download).toEqual([...base.keys()].filter((p) => p.startsWith('project/')).sort());
    });

    it('downloads nothing from a marker when nothing changed', () => {
        expect(planCanvas({ baseline: base, main: new Map(base), from: 'marker' }).download).toEqual([]);
    });
});

describe('driftVerdict', () => {
    const baseline = tree({ 'project/a.html': oid(1), 'project/b.html': oid(2), 'project/keep.html': oid(5) });
    const main = tree({ 'project/a.html': oid(9), 'project/keep.html': oid(5), 'project/z.html': oid(4) });
    const plan = planCanvas({ baseline, main, from: 'marker' });
    const allLive = ['project/a.html', 'project/b.html', 'project/keep.html'];

    it('is clean when every downloaded file equals the baseline', () => {
        const verdict = driftVerdict({
            plan,
            liveOids: tree({ 'project/a.html': oid(1), 'project/b.html': oid(2) }),
            livePaths: allLive,
        });

        expect(verdict.verdict).toBe('clean');
        expect(verdict.files).toEqual([
            { path: 'project/a.html', state: 'atBaseline' },
            { path: 'project/b.html', state: 'atBaseline' },
            { path: 'project/z.html', state: 'atBaseline' },
        ]);
    });

    it('accepts a live file that already equals main (a drift import that merged, or a retry)', () => {
        const verdict = driftVerdict({
            plan,
            liveOids: tree({ 'project/a.html': oid(9), 'project/b.html': oid(2), 'project/z.html': oid(4) }),
            livePaths: [...allLive, 'project/z.html'],
        });

        expect(verdict.verdict).toBe('clean');
        expect(verdict.files.find((f) => f.path === 'project/a.html')?.state).toBe('atMain');
        expect(verdict.files.find((f) => f.path === 'project/z.html')?.state).toBe('atMain');
    });

    it('is drift when a live file equals neither the baseline nor main', () => {
        const verdict = driftVerdict({
            plan,
            liveOids: tree({ 'project/a.html': oid(77), 'project/b.html': oid(2) }),
            livePaths: allLive,
        });

        expect(verdict.verdict).toBe('drift');
        expect(verdict.files.find((f) => f.path === 'project/a.html')?.state).toBe('drift');
    });

    it('fails closed when a file that is live was not downloaded', () => {
        const verdict = driftVerdict({ plan, liveOids: tree({ 'project/a.html': oid(1) }), livePaths: allLive });

        expect(verdict.verdict).toBe('drift');
        expect(verdict.files.find((f) => f.path === 'project/b.html')?.state).toBe('drift');
    });

    it('is drift when a path the repo adds is already live with other content', () => {
        const verdict = driftVerdict({
            plan,
            liveOids: tree({ 'project/a.html': oid(1), 'project/b.html': oid(2), 'project/z.html': oid(66) }),
            livePaths: [...allLive, 'project/z.html'],
        });

        expect(verdict.verdict).toBe('drift');
        expect(verdict.files.find((f) => f.path === 'project/z.html')?.state).toBe('drift');
    });

    it('is drift when a path the repo deletes is gone live but baseline and main disagree on it being absent', () => {
        // b.html is deleted in main: absent live equals main, so it is accepted.
        const verdict = driftVerdict({
            plan,
            liveOids: tree({ 'project/a.html': oid(1) }),
            livePaths: ['project/a.html', 'project/keep.html'],
        });

        expect(verdict.verdict).toBe('clean');
        expect(verdict.files.find((f) => f.path === 'project/b.html')?.state).toBe('atMain');
    });

    it('is drift when a live board the baseline holds and main keeps is missing', () => {
        const verdict = driftVerdict({
            plan,
            liveOids: tree({ 'project/a.html': oid(1), 'project/b.html': oid(2) }),
            livePaths: ['project/a.html', 'project/b.html'],
        });

        expect(verdict.missingLive).toEqual(['project/keep.html']);
        expect(verdict.verdict).toBe('drift');
    });

    it('is drift when the live canvas holds a path neither tree has', () => {
        const verdict = driftVerdict({
            plan,
            liveOids: tree({ 'project/a.html': oid(1), 'project/b.html': oid(2) }),
            livePaths: [...allLive, 'project/stray.html'],
        });

        expect(verdict.extraLive).toEqual(['project/stray.html']);
        expect(verdict.verdict).toBe('drift');
    });

    it('ignores the marker and files outside project/ in the live list', () => {
        const verdict = driftVerdict({
            plan,
            liveOids: tree({ 'project/a.html': oid(1), 'project/b.html': oid(2) }),
            livePaths: [...allLive, 'project/published.json', 'index.html', 'artifact-type/x.js'],
        });

        expect(verdict.extraLive).toEqual([]);
        expect(verdict.verdict).toBe('clean');
    });
});

describe('publishInput', () => {
    const plan = planCanvas({
        baseline: tree({ 'project/a.html': oid(1), 'project/b.html': oid(2) }),
        main: tree({ 'project/a.html': oid(9) }),
        from: 'marker',
    });

    it('maps changed paths to files and deleted paths to null, and leaves the marker out of files', () => {
        const input = publishInput({
            url: 'https://x/y',
            folder: 'Home',
            outDir: '/out',
            plan,
            baselineSha: SHA_B,
            mainSha: SHA_A,
        });

        expect(input.url).toBe('https://x/y');
        expect(input.root).toBe('/out/Home');
        expect(input.files).toEqual({ 'project/a.html': '/out/Home/project/a.html', 'project/b.html': null });
    });

    // The Artifact tool refuses a publish of a typed artifact without `file_path`, which must be one of its own data
    // files under `root`. The marker is the one file every publish sends, so it is that file. It sits in the staging
    // directory, not the repository, so a commit never has to contain its own sha.
    it('makes the marker the file_path, under root at project/published.json', () => {
        const input = publishInput({
            url: 'https://x/y',
            folder: 'Home',
            outDir: '/out',
            plan,
            baselineSha: SHA_B,
            mainSha: SHA_A,
        });

        expect(input.filePath).toBe('/out/Home/project/published.json');
        expect(input.marker).toEqual({ path: '/out/Home/project/published.json', content: `{"sha":"${SHA_A}"}\n` });
    });

    it('gives an empty files map when nothing changed, so only the marker is sent', () => {
        const unchanged = planCanvas({
            baseline: tree({ 'project/a.html': oid(1) }),
            main: tree({ 'project/a.html': oid(1) }),
            from: 'snapshot',
        });
        const input = publishInput({
            url: 'https://x/y',
            folder: 'Home',
            outDir: '/out',
            plan: unchanged,
            baselineSha: SHA_B,
            mainSha: SHA_A,
        });

        expect(input.files).toEqual({});
    });
});

describe('publishLabel', () => {
    it('names both commits by their 12-character prefix', () => {
        expect(publishLabel(SHA_B, SHA_A)).toBe(`canvas ${SHA_B.slice(0, 12)}..${SHA_A.slice(0, 12)}`);
    });

    // The Artifact tool caps `label` at 60 characters; the old form with the id and two full shas was 110.
    it('fits the Artifact label limit of 60 characters', () => {
        expect(publishLabel(SHA_B, SHA_A).length).toBeLessThanOrEqual(60);
    });
});
