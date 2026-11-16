/**
 * The canvas publish planner against a real temporary git repository: it runs the real `bin/canvasPublishPlan.ts`
 * and asserts its JSON and exit codes. Git, the file system and the process boundary are the risk here, and a mocked
 * git could not show that a binary blob survives, that a rename is a delete plus an add, or that a dirty work tree
 * cannot leak into a publish.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const PACKAGE_ROOT = join(import.meta.dirname, '..');
const BIN = join(PACKAGE_ROOT, 'bin/canvasPublishPlan.ts');
const TSX = join(PACKAGE_ROOT, '../../../node_modules/.bin/tsx');
const URL_HOME = 'https://claude.ai/artifact/HomeWeb';
// The CLI's JSON output, parsed so a changed shape fails here by name instead of reading as `any`.
const PlanOutput = z.looseObject({
    main: z.looseObject({ sha: z.string() }),
    canvases: z.array(
        z.looseObject({
            id: z.string(),
            baseline: z.looseObject({ sha: z.string(), from: z.string() }),
            download: z.array(z.string()),
            expected: z.record(
                z.string(),
                z.looseObject({ baseline: z.string().nullable(), main: z.string().nullable() }),
            ),
        }),
    ),
});
const CheckOutput = z.looseObject({
    verdict: z.string(),
    files: z.array(z.looseObject({ path: z.string(), state: z.string() })),
    extraLive: z.array(z.string()).optional(),
});
const StageOutput = z.looseObject({
    url: z.string(),
    root: z.string(),
    file_path: z.string(),
    files: z.record(z.string(), z.string().nullable()),
    label: z.string(),
});

const parsePlan = (stdout: string) => PlanOutput.parse(JSON.parse(stdout));
const parseCheck = (stdout: string) => CheckOutput.parse(JSON.parse(stdout));
const parseStage = (stdout: string) => StageOutput.parse(JSON.parse(stdout));

const FONT_V1 = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a, 0x0d, 0x00, 0xc3, 0x28]);
const FONT_V2 = Buffer.from([0xff, 0x00, 0x81, 0x0d, 0x0a, 0xc3]);

let repo: string;
let live: string;
let out: string;
let sandbox: string;

function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

async function put(path: string, content: string | Buffer): Promise<void> {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), content);
}

function commit(message: string): string {
    git('add', '--all');
    git('commit', '-q', '-m', message);
    const sha = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', sha);

    return sha;
}

const CANVAS = 'docs/design/canvases/Home';

function run(args: string[], env?: Record<string, string>): { code: number | null; stdout: string; stderr: string } {
    const result = spawnSync(TSX, [BIN, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });

    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function writeLive(files: Record<string, string | Buffer>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
        const target = join(live, 'Home', path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
    }
}

async function writeList(paths: string[]): Promise<string> {
    const file = join(sandbox, 'list.json');
    await writeFile(file, JSON.stringify(paths));

    return file;
}

const BASELINE_FILES = {
    'project/canvas.json': '{"boards":{}}\n',
    'project/a.html': '<p>a1</p>\n',
    'project/b.html': '<p>b</p>\n',
    'project/font.woff2': FONT_V1,
};

let snapshotSha: string;
let mainSha: string;

beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'canvasPlan-'));
    repo = join(sandbox, 'repo');
    live = join(sandbox, 'live');
    out = join(sandbox, 'out');
    await mkdir(repo);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.autocrlf', 'false');
    await put(
        'docs/design/canvases/registry.json',
        JSON.stringify({
            canvases: [
                { id: 'homeWeb', url: URL_HOME, kind: 'page', source: 'repo-canvas', folder: 'Home' },
                { id: 'oldLive', url: 'https://claude.ai/artifact/Old', kind: 'page', source: 'live' },
            ],
        }),
    );
    await put(`${CANVAS}/snapshot.json`, '{"source":"x"}\n');

    for (const [path, content] of Object.entries(BASELINE_FILES)) {
        await put(`${CANVAS}/${path}`, content);
    }

    snapshotSha = commit('snapshot');
    // main: a.html changed, b.html renamed to c.html, the font replaced, d.html added.
    await put(`${CANVAS}/project/a.html`, '<p>a2</p>\n');
    git('mv', `${CANVAS}/project/b.html`, `${CANVAS}/project/c.html`);
    await put(`${CANVAS}/project/font.woff2`, FONT_V2);
    mainSha = commit('change');
});

afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
});

describe('plan', () => {
    it('reports the changes since the snapshot, with a full download list, when the canvas has no marker', async () => {
        const result = run(['plan', '--live', live]);

        expect(result.code).toBe(0);
        const plan = parsePlan(result.stdout);
        expect(plan.main.sha).toBe(mainSha);
        expect(plan.canvases).toHaveLength(1);
        const [canvas] = plan.canvases;
        expect(canvas).toMatchObject({
            id: 'homeWeb',
            url: URL_HOME,
            folder: 'Home',
            baseline: { sha: snapshotSha, from: 'snapshot' },
            status: 'publish',
            changed: ['project/a.html', 'project/c.html', 'project/font.woff2'],
            deleted: ['project/b.html'],
            download: [
                'project/a.html',
                'project/b.html',
                'project/c.html',
                'project/canvas.json',
                'project/font.woff2',
            ],
        });
        expect(canvas.expected['project/font.woff2']).toEqual({
            baseline: git('rev-parse', `${snapshotSha}:${CANVAS}/project/font.woff2`),
            main: git('rev-parse', `${mainSha}:${CANVAS}/project/font.woff2`),
        });
        expect(JSON.stringify(plan)).not.toContain('snapshot.json');
    });

    it('baselines on the marker and downloads only the touched paths', async () => {
        await writeLive({ 'project/published.json': `{"sha":"${snapshotSha}"}` });
        const [canvas] = parsePlan(run(['plan', '--live', live]).stdout).canvases;

        expect(canvas.baseline).toEqual({ sha: snapshotSha, from: 'marker' });
        expect(canvas.download).toEqual(['project/a.html', 'project/b.html', 'project/c.html', 'project/font.woff2']);
    });

    it('reports unchanged when the marker already names main', async () => {
        await writeLive({ 'project/published.json': `{"sha":"${mainSha}"}` });
        const [canvas] = parsePlan(run(['plan', '--live', live]).stdout).canvases;

        expect(canvas).toMatchObject({ status: 'unchanged', changed: [], deleted: [], download: [] });
    });

    it.each([
        ['an invalid marker', '{"sha":"nope"}'],
        ['a marker sha that is not on main', `{"sha":"${'1'.repeat(40)}"}`],
    ])('exits 2 on %s and never falls back to the snapshot', async (_name, marker) => {
        await writeLive({ 'project/published.json': marker });
        const result = run(['plan', '--live', live]);

        expect(result.code).toBe(2);
        expect(result.stdout).toBe('');
    });

    it('exits 2 on a marker sha that exists but is not an ancestor of main', async () => {
        git('checkout', '-q', '-b', 'side', snapshotSha);
        await put(`${CANVAS}/project/side.html`, 'side\n');
        git('add', '--all');
        git('commit', '-q', '-m', 'side');
        const side = git('rev-parse', 'HEAD');
        git('checkout', '-q', 'main');
        await writeLive({ 'project/published.json': `{"sha":"${side}"}` });

        expect(run(['plan', '--live', live]).code).toBe(2);
    });

    it('lists no canvas while the registry has no repo-canvas entry', async () => {
        await put(
            'docs/design/canvases/registry.json',
            JSON.stringify({ canvases: [{ id: 'oldLive', url: 'u', kind: 'page', source: 'live' }] }),
        );
        commit('registry');

        const result = run(['plan', '--live', live]);

        expect(result.code).toBe(0);
        expect(parsePlan(result.stdout).canvases).toEqual([]);
    });

    it('rejects a folder that could escape the canvases directory', async () => {
        await put(
            'docs/design/canvases/registry.json',
            JSON.stringify({ canvases: [{ id: 'x', url: 'u', kind: 'page', source: 'repo-canvas', folder: '../..' }] }),
        );
        commit('registry');

        expect(run(['plan', '--live', live]).code).toBe(2);
    });
});

describe('check', () => {
    async function liveAtBaseline(): Promise<string> {
        await writeLive({ ...BASELINE_FILES });

        return writeList(Object.keys(BASELINE_FILES));
    }

    it('is clean when every live file equals the baseline, binary files included', async () => {
        const list = await liveAtBaseline();
        const result = run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]);

        expect(result.code).toBe(0);
        const verdict = parseCheck(result.stdout);
        expect(verdict.verdict).toBe('clean');
        expect(verdict.files.find((f) => f.path === 'project/font.woff2')?.state).toBe('atBaseline');
    });

    it('is drift (exit 1) when a live board was edited on claude.ai', async () => {
        const list = await liveAtBaseline();
        await writeLive({ 'project/a.html': '<p>edited live</p>\n' });
        const result = run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]);

        expect(result.code).toBe(1);
        const verdict = parseCheck(result.stdout);
        expect(verdict.verdict).toBe('drift');
        expect(verdict.files.find((f) => f.path === 'project/a.html')?.state).toBe('drift');
    });

    it('is drift when a live binary differs by one byte', async () => {
        const list = await liveAtBaseline();
        await writeLive({ 'project/font.woff2': Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a, 0x0d, 0x00, 0xc3, 0x29]) });

        expect(run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]).code).toBe(1);
    });

    it('accepts a live file that already equals main', async () => {
        const list = await liveAtBaseline();
        await writeLive({ 'project/a.html': '<p>a2</p>\n' });
        const result = run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]);

        expect(result.code).toBe(0);
        expect(parseCheck(result.stdout).files.find((f) => f.path === 'project/a.html')?.state).toBe('atMain');
    });

    it('is drift when a file that is live was never downloaded', async () => {
        const list = await liveAtBaseline();
        await rm(join(live, 'Home/project/b.html'));

        expect(run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]).code).toBe(1);
    });

    it('is drift when the live canvas holds a stray path', async () => {
        const list = await writeList([...Object.keys(BASELINE_FILES), 'project/stray.html']);
        await writeLive({ ...BASELINE_FILES });
        const result = run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]);

        expect(result.code).toBe(1);
        expect(parseCheck(result.stdout).extraLive).toEqual(['project/stray.html']);
    });

    it('exits 2 for an unknown canvas id', async () => {
        const list = await liveAtBaseline();

        expect(run(['check', 'nope', '--main', mainSha, '--live', live, '--list', list]).code).toBe(2);
    });

    it('exits 2 when --main is not a commit on origin/main', async () => {
        const list = await liveAtBaseline();

        expect(run(['check', 'homeWeb', '--main', '2'.repeat(40), '--live', live, '--list', list]).code).toBe(2);
    });

    it('exits 2 when the live list holds the marker but it was never downloaded', async () => {
        await writeLive({ ...BASELINE_FILES });
        const list = await writeList([...Object.keys(BASELINE_FILES), 'project/published.json']);
        const result = run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('published.json');
    });

    it('exits 2 when --main is behind the tip and the canvas changed in between', async () => {
        const list = await liveAtBaseline();
        await put(`${CANVAS}/project/a.html`, '<p>a3</p>\n');
        commit('later change to the canvas');
        const result = run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('behind');
    });

    it('accepts --main behind the tip when the canvas folder did not change in between', async () => {
        const list = await liveAtBaseline();
        await put('docs/other.md', 'unrelated\n');
        commit('unrelated change');

        expect(run(['check', 'homeWeb', '--main', mainSha, '--live', live, '--list', list]).code).toBe(0);
    });
});

describe('stage', () => {
    it('writes main blobs byte for byte, the marker as file_path under root, and a dict with null for a deletion', async () => {
        await writeLive({ ...BASELINE_FILES });
        const list = await writeList(Object.keys(BASELINE_FILES));
        // A dirty work tree must not reach the publish.
        await put(`${CANVAS}/project/a.html`, 'DIRTY\n');

        const result = run(['stage', 'homeWeb', '--main', mainSha, '--live', live, '--list', list, '--out', out]);

        expect(result.code).toBe(0);
        const staged = parseStage(result.stdout);
        expect(staged.url).toBe(URL_HOME);
        expect(staged.root).toBe(join(out, 'Home'));
        expect(staged.files).toEqual({
            'project/a.html': join(out, 'Home/project/a.html'),
            'project/c.html': join(out, 'Home/project/c.html'),
            'project/font.woff2': join(out, 'Home/project/font.woff2'),
            'project/b.html': null,
        });
        expect(staged.file_path).toBe(join(out, 'Home/project/published.json'));
        expect(await readFile(join(out, 'Home/project/a.html'), 'utf8')).toBe('<p>a2</p>\n');
        expect(Buffer.compare(await readFile(join(out, 'Home/project/font.woff2')), FONT_V2)).toBe(0);
        expect(JSON.parse(await readFile(staged.file_path, 'utf8'))).toEqual({ sha: mainSha });
        // The marker is staged, never written into the repository's canvas folder.
        expect(await readdir(join(repo, CANVAS, 'project'))).not.toContain('published.json');
        expect(await readdir(join(out, 'Home/project'))).not.toContain('b.html');
    });

    it('prints a label that names baseline..main and fits the Artifact 60-character limit', async () => {
        await writeLive({ ...BASELINE_FILES });
        const list = await writeList(Object.keys(BASELINE_FILES));
        const staged = parseStage(
            run(['stage', 'homeWeb', '--main', mainSha, '--live', live, '--list', list, '--out', out]).stdout,
        );

        expect(staged.label).toBe(`canvas ${snapshotSha.slice(0, 12)}..${mainSha.slice(0, 12)}`);
        expect(staged.label.length).toBeLessThanOrEqual(60);
    });

    it.each([
        ['the snapshot', null],
        ['a marker', 'marker'],
    ])('puts every path of the baseline..main diff in files, from %s', async (_name, from) => {
        await writeLive({
            ...BASELINE_FILES,
            ...(from === null ? {} : { 'project/published.json': `{"sha":"${snapshotSha}"}` }),
        });
        const list = await writeList([
            ...Object.keys(BASELINE_FILES),
            ...(from === null ? [] : ['project/published.json']),
        ]);
        const staged = parseStage(
            run(['stage', 'homeWeb', '--main', mainSha, '--live', live, '--list', list, '--out', out]).stdout,
        );
        const diff = git('diff', '--no-renames', '--name-status', snapshotSha, mainSha, '--', `${CANVAS}/project`)
            .split('\n')
            .map((line) => line.split('\t') as [string, string]);

        expect(diff.length).toBeGreaterThan(0);

        for (const [status, path] of diff) {
            const key = path.slice(`${CANVAS}/`.length);

            expect(staged.files, key).toHaveProperty([key], status === 'D' ? null : expect.stringContaining(key));
        }

        expect(Object.keys(staged.files).sort()).toEqual(diff.map(([, p]) => p.slice(`${CANVAS}/`.length)).sort());
    });

    // The first publish from main of a canvas unchanged since its snapshot: the case that failed live on 2026-11-15,
    // because stage printed no file_path and a 110-character label.
    it('stages only the marker, as file_path, for a first publish with nothing changed since the snapshot', async () => {
        git('update-ref', 'refs/remotes/origin/main', snapshotSha);
        await writeLive({ ...BASELINE_FILES });
        const list = await writeList(Object.keys(BASELINE_FILES));

        const result = run(['stage', 'homeWeb', '--main', snapshotSha, '--live', live, '--list', list, '--out', out]);

        expect(result.code).toBe(0);
        const staged = parseStage(result.stdout);
        expect(staged.files).toEqual({});
        expect(staged.file_path).toBe(join(staged.root, 'project/published.json'));
        expect(JSON.parse(await readFile(staged.file_path, 'utf8'))).toEqual({ sha: snapshotSha });
        expect(staged.label).toBe(`canvas ${snapshotSha.slice(0, 12)}..${snapshotSha.slice(0, 12)}`);
    });

    it('exits 0 and prints nothing when the marker already names main', async () => {
        await writeLive({ 'project/published.json': `{"sha":"${mainSha}"}` });
        const list = await writeList(['project/published.json']);
        const result = run(['stage', 'homeWeb', '--main', mainSha, '--live', live, '--list', list, '--out', out]);

        expect(result.code).toBe(0);
        expect(result.stdout).toBe('');
        await expect(readdir(out)).rejects.toThrow();
    });

    it('refuses on drift with exit 1 and writes nothing', async () => {
        await writeLive({ ...BASELINE_FILES, 'project/a.html': 'edited live\n' });
        const list = await writeList(Object.keys(BASELINE_FILES));

        const result = run(['stage', 'homeWeb', '--main', mainSha, '--live', live, '--list', list, '--out', out]);

        expect(result.code).toBe(1);
        await expect(readdir(out)).rejects.toThrow();
    });
});

describe('LFS images', () => {
    const ASSET = 'project/assets/0123456789abcdef.webp';
    const IMAGE = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x0d, 0x0a, 0x57, 0x45, 0x42, 0x50, 0x80]);
    const POINTER_START = 'version https://git-lfs.github.com/spec/v1';
    let lfsMainSha: string;

    beforeEach(async () => {
        git('lfs', 'install', '--local', '--skip-repo');
        await put(
            '.gitattributes',
            'docs/design/canvases/*/** -text\ndocs/design/canvases/*/project/assets/** filter=lfs diff=lfs merge=lfs -text\n',
        );
        await put(`${CANVAS}/${ASSET}`, IMAGE);
        lfsMainSha = commit('image');
    });

    async function liveWithImage(): Promise<string> {
        await writeLive({ ...BASELINE_FILES, 'project/a.html': '<p>a2</p>\n', [ASSET]: IMAGE });

        return writeList([...Object.keys(BASELINE_FILES), ASSET]);
    }

    it('stores the image as a pointer in git, so the fixture really is LFS', () => {
        expect(git('cat-file', 'blob', `${lfsMainSha}:${CANVAS}/${ASSET}`)).toContain(POINTER_START);
    });

    it('stage writes the real image bytes, never the pointer text', async () => {
        const list = await liveWithImage();
        const result = run(['stage', 'homeWeb', '--main', lfsMainSha, '--live', live, '--list', list, '--out', out]);

        expect(result.code).toBe(0);
        const written = await readFile(join(out, 'Home', ASSET));
        expect(Buffer.compare(written, IMAGE)).toBe(0);
    });

    it('check accepts a live image that equals the real image (no drift)', async () => {
        const list = await liveWithImage();
        const result = run(['check', 'homeWeb', '--main', lfsMainSha, '--live', live, '--list', list]);

        expect(result.code).toBe(0);
        expect(parseCheck(result.stdout).files.find((f) => f.path === ASSET)?.state).toBe('atMain');
    });

    it('check keeps byte-exact hashing for a non-LFS file with CRLF line endings', async () => {
        await put(`${CANVAS}/project/crlf.html`, '<p>x</p>\r\n');
        const crlfSha = commit('crlf');
        await writeLive({
            ...BASELINE_FILES,
            'project/a.html': '<p>a2</p>\n',
            [ASSET]: IMAGE,
            'project/crlf.html': '<p>x</p>\r\n',
        });
        const list = await writeList([...Object.keys(BASELINE_FILES), ASSET, 'project/crlf.html']);
        const result = run(['check', 'homeWeb', '--main', crlfSha, '--live', live, '--list', list]);

        expect(result.code).toBe(0);
        expect(parseCheck(result.stdout).files.find((f) => f.path === 'project/crlf.html')?.state).toBe('atMain');
    });

    it('stage never writes pointer text when the filter hands back a pointer', async () => {
        await writeLive({ ...BASELINE_FILES });
        const list = await writeList(Object.keys(BASELINE_FILES));
        await rm(join(repo, '.git/lfs/objects'), { recursive: true, force: true });
        // GIT_LFS_SKIP_SMUDGE makes the smudge filter answer the pointer itself instead of failing on the object.
        const result = run(['stage', 'homeWeb', '--main', lfsMainSha, '--live', live, '--list', list, '--out', out], {
            GIT_LFS_SKIP_SMUDGE: '1',
        });

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('lfs pull');
        expect(await readdir(join(out, 'Home/project/assets')).catch(() => [])).toEqual([]);
    });

    it('stage fails with the pull command when the LFS object is missing', async () => {
        // The image is not live yet, so `check` hashes nothing that would re-store the object it is about to lose.
        await writeLive({ ...BASELINE_FILES });
        const list = await writeList(Object.keys(BASELINE_FILES));
        await rm(join(repo, '.git/lfs/objects'), { recursive: true, force: true });
        const result = run(['stage', 'homeWeb', '--main', lfsMainSha, '--live', live, '--list', list, '--out', out]);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain(
            "git -c lfs.fetchexclude= lfs pull --include='docs/design/canvases/Home/project/assets/**'",
        );
        expect(await readdir(join(out, 'Home/project/assets')).catch(() => [])).toEqual([]);
    });
});

describe('usage', () => {
    it.each([[[]], [['frobnicate']], [['plan']]])('exits 2 for bad arguments %j', (args) => {
        expect(run(args).code).toBe(2);
    });
});
