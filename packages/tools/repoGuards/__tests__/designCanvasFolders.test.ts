/**
 * Each screen canvas's source is a folder under `docs/design/canvases/<folder>/`: `snapshot.json` (which published
 * artifact it came from) and `project/**` (the files the artifact holds). A publish sends those files byte for byte,
 * so this guard holds the folders to the structure the README promises, before a bad folder reaches a publish.
 *
 * The HTML is held to two readings: parse5 (it tokenizes cleanly) and html-validate (the tree).
 *
 * Every rule is a pure `*Problems()` function that returns broken-rule messages. The checks over the real folders read
 * the tracked file list with `git ls-files`, so an untracked scratch file never counts.
 *
 * @see docs/design/canvases/README.md
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HtmlValidate } from 'html-validate';
import { parse } from 'parse5';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const CANVAS_DIR = join(REPO_ROOT, 'docs', 'design', 'canvases');

/**
 * The html-validate tree rules the canvases are held to. parse5 reports only tokenizer errors, so a stray closing
 * tag, a `<div>` in a `<p>` or a nested `<a>` pass it; these three rules read the tree.
 */
const TREE_RULES = ['close-order', 'element-permitted-content', 'no-dup-id'] as const;

/**
 * The tree findings the published snapshot already carries, per rule, measured 2026-11-15. The files
 * must stay byte-identical to the live canvases, so they are counted rather than edited. The count is exact: a new
 * finding fails, and a fixed one forces this number down.
 */
const ALLOWED_TREE_FINDINGS: Readonly<Record<(typeof TREE_RULES)[number], { count: number; reason: string }>> = {
    'close-order': { count: 0, reason: 'measured: no finding' },
    'element-permitted-content': {
        count: 59,
        reason: 'measured 2026-11-15: the live boards put <p> (48) and <div> (2) inside <span>, and <div> (9) inside <button>',
    },
    'no-dup-id': { count: 25, reason: 'the live boards repeat an id inside one file' },
};

/**
 * The parse5 error codes the published canvases are allowed to raise, measured on the real snapshot. HTML parsing
 * never fails, so a clean tokenization is a statement about the markup: a code that is not named here is a new kind of
 * breakage. Each entry says why it is tolerated.
 */
const ALLOWED_PARSE_ERRORS: Readonly<Record<string, string>> = {}; // measured 2026-11-15: 0 errors

const registrySchema = z.object({
    canvases: z.array(z.object({ id: z.string(), folder: z.string().optional() })),
});

/** The parts of `canvas.json` this guard reads. The file carries more (notes, design systems), left untouched. */
const canvasJsonSchema = z.object({
    boards: z.record(z.string(), z.object({ w: z.number(), h: z.number() })),
    order: z.array(z.string()),
});

/** Files that sit beside the folders. */
const TOP_LEVEL_FILES: ReadonlySet<string> = new Set(['README.md', 'registry.json']);

/** `<folder>/project/…` split into its folder and the path inside `project/`. */
const PROJECT_FILE = /^([^/]+)\/project\/(.+)$/u;

/**
 * Every folder is claimed by exactly one registry entry, and every entry's folder exists.
 *
 * @param folders - The directory names found under `canvases/`.
 * @param claims - The registry entries as `{id, folder}`; an entry with no folder claims nothing.
 */
export function claimProblems(
    folders: readonly string[],
    claims: readonly { readonly id: string; readonly folder?: string }[],
): readonly string[] {
    const claimed = claims.flatMap((claim) => (claim.folder === undefined ? [] : [claim.folder]));

    return [
        ...folders
            .filter((folder) => claimed.filter((name) => name === folder).length !== 1)
            .map((folder) => `${folder}: the folder is not claimed by exactly one registry entry`),
        ...claims
            .filter((claim) => claim.folder !== undefined && !folders.includes(claim.folder))
            .map((claim) => `${claim.id}: its folder ${String(claim.folder)} does not exist`),
    ];
}

/**
 * Only `README.md`, `registry.json`, `<folder>/snapshot.json` and `<folder>/project/**` are tracked. The publish marker
 * `project/published.json` and an `artifact-type/` folder are refused: the marker cannot sit in the commit it records,
 * and the artifact type owns its own files.
 *
 * @param files - Tracked paths relative to `canvases/`.
 */
export function trackedFileProblems(files: readonly string[]): readonly string[] {
    const problems = files.flatMap((file) => {
        const inProject = PROJECT_FILE.exec(file);

        if (TOP_LEVEL_FILES.has(file) || /^[^/]+\/snapshot\.json$/u.test(file)) {
            return [];
        }

        if (inProject !== null) {
            return inProject[2] === 'published.json' ? [`${file}: the publish marker is never committed`] : [];
        }

        return [`${file}: not README.md, registry.json, <folder>/snapshot.json or <folder>/project/**`];
    });

    return problems.concat(
        files.filter((file) => file.includes('artifact-type/')).map((file) => `${file}: artifact-type/ is not ours`),
    );
}

/**
 * A folder has its `snapshot.json` and `project/canvas.json`.
 *
 * @param folder - The folder name.
 * @param files - Tracked paths relative to `canvases/`.
 */
export function requiredFileProblems(folder: string, files: readonly string[]): readonly string[] {
    return [`${folder}/snapshot.json`, `${folder}/project/canvas.json`]
        .filter((required) => !files.includes(required))
        .map((required) => `${required}: missing`);
}

/**
 * `canvas.json` places every board file, and names no file that does not exist.
 *
 * @param folder - The folder name.
 * @param canvasJson - The parsed `canvas.json`.
 * @param projectFiles - Paths inside `project/` of the folder's tracked files.
 */
export function canvasJsonProblems(
    folder: string,
    canvasJson: z.infer<typeof canvasJsonSchema>,
    projectFiles: readonly string[],
): readonly string[] {
    const boards = Object.keys(canvasJson.boards);
    const exists = (name: string): boolean => projectFiles.includes(name);

    return [
        ...boards.filter((name) => !exists(name)).map((name) => `${folder}: boards names ${name}, which is missing`),
        ...canvasJson.order
            .filter((name) => !exists(name))
            .map((name) => `${folder}: order names ${name}, which is missing`),
        ...projectFiles
            .filter((name) => name.endsWith('.dc.html') && !boards.includes(name))
            .map((name) => `${folder}: ${name} is not placed in canvas.json`),
    ];
}

/**
 * The parse5 error codes a document raises, repeated once per occurrence.
 *
 * @param html - The document source.
 */
export function parseErrorCodes(html: string): readonly string[] {
    const codes: string[] = [];

    parse(html, { onParseError: (error) => codes.push(error.code) });

    return codes;
}

/**
 * A document may raise only the allowlisted parse5 error codes.
 *
 * @param file - The path, for the message.
 * @param html - The document source.
 * @param allowed - The allowlisted codes.
 */
export function htmlProblems(file: string, html: string, allowed: readonly string[]): readonly string[] {
    const unknown = [...new Set(parseErrorCodes(html).filter((code) => !allowed.includes(code)))];

    return unknown.map((code) => `${file}: parse error ${code}`);
}

const treeValidator = new HtmlValidate({
    root: true,
    rules: Object.fromEntries(TREE_RULES.map((rule) => [rule, 'error'])),
});

/**
 * The tree rules a document breaks, once per finding. It reads tree construction, which parse5's error list does not.
 *
 * @param html - The document source.
 * @returns The rule id of each finding.
 */
export async function treeFindingRules(html: string): Promise<readonly string[]> {
    const report = await treeValidator.validateString(html);

    return report.results.flatMap((result) => result.messages.map((message) => message.ruleId ?? 'unknown'));
}

/**
 * No tracked canvas file points at the host's blob store. Images are canvas files under `project/assets/`.
 *
 * @param texts - Each tracked non-asset file's text, by path.
 */
export function blobReferenceProblems(texts: ReadonlyMap<string, string>): readonly string[] {
    return [...texts]
        .filter(([, text]) => text.includes('/_blob/'))
        .map(([file]) => `${file}: references /_blob/; images are canvas files under project/assets/ (ADR-0092)`);
}

/** An image a board names: `assets/<file>` in a `url()`, a `src` or any other form. */
const ASSET_REFERENCE = /assets\/([\w.-]+\.(?:webp|png|jpe?g|gif|avif|svg))/gu;

/**
 * Every image a board names is a tracked file of the same folder, and every tracked image is named by a board there.
 *
 * @param folder - The folder name.
 * @param boards - Each html file's text under `project/`, by its path inside `project/`.
 * @param assets - The file names tracked in the folder's `project/assets/`.
 */
export function assetReferenceProblems(
    folder: string,
    boards: ReadonlyMap<string, string>,
    assets: readonly string[],
): readonly string[] {
    const used = new Set<string>();
    const missing = [...boards].flatMap(([board, text]) =>
        [...text.matchAll(ASSET_REFERENCE)].flatMap(([, name = '']) => {
            used.add(name);

            return assets.includes(name)
                ? []
                : [`${folder}: ${board} references assets/${name}, which is not tracked in project/assets/`];
        }),
    );

    return [
        ...missing,
        ...assets
            .filter((name) => !used.has(name))
            .map((name) => `${folder}: assets/${name} is not referenced by any board`),
    ];
}

/**
 * Every canvas image is an LFS pointer in the index. A raw image there means it was added without the filter, and
 * would bloat the history for good.
 *
 * @param blobs - The index blob's text of each asset, by repo path.
 */
export function lfsPointerProblems(blobs: ReadonlyMap<string, string>): readonly string[] {
    return [...blobs]
        .filter(([, text]) => !text.startsWith('version https://git-lfs.github.com/spec/v1\n'))
        .map(([file]) => `${file}: the index holds the image, not an LFS pointer; run git add --renormalize ${file}`);
}

/**
 * LFS stores exactly the canvas assets, and nothing else in the repository.
 *
 * @param assets - The tracked canvas asset paths.
 * @param lfs - The tracked paths `.gitattributes` gives the lfs filter.
 */
export function lfsScopeProblems(assets: readonly string[], lfs: readonly string[]): readonly string[] {
    return [
        ...assets
            .filter((file) => !lfs.includes(file))
            .map((file) => `${file}: a canvas asset that .gitattributes does not store with LFS`),
        ...lfs
            .filter((file) => !assets.includes(file))
            .map((file) => `${file}: stored with LFS, but only canvas assets may be (ADR-0092)`),
    ];
}

/**
 * The push hook uploads LFS objects. Without it a push sends pointers whose images no clone can fetch.
 *
 * @param hook - `.husky/pre-push`'s text, or `null` when the file is absent.
 */
export function prePushHookProblems(hook: string | null): readonly string[] {
    if (hook === null) {
        return ['.husky/pre-push: missing; images would be pushed as pointers'];
    }

    return hook.includes('git lfs pre-push "$@"') ? [] : ['.husky/pre-push: does not run `git lfs pre-push "$@"`'];
}

/**
 * The index blob of each path, as text (a pointer is ASCII; an image read here would be garbage, which the caller
 * rejects by its prefix).
 *
 * @sideEffect Runs `git cat-file --batch`.
 * @param paths - Repo-relative paths.
 */
function indexBlobs(paths: readonly string[]): ReadonlyMap<string, string> {
    const out = execFileSync('git', ['cat-file', '--batch'], {
        cwd: REPO_ROOT,
        input: paths.map((path) => `:${path}\n`).join(''),
        maxBuffer: 1024 * 1024 * 1024,
    });
    const blobs = new Map<string, string>();
    let at = 0;

    for (const path of paths) {
        const lineEnd = out.indexOf('\n', at);
        const [, type, size] = out.toString('latin1', at, lineEnd).split(' ');

        if (type !== 'blob' || size === undefined) {
            throw new Error(`${path}: not in the index (${out.toString('latin1', at, lineEnd)})`);
        }

        const start = lineEnd + 1;
        blobs.set(path, out.toString('latin1', start, start + Number(size)).slice(0, 200));
        at = start + Number(size) + 1;
    }

    return blobs;
}

/** Tracked paths under `canvases/`, relative to it. @sideEffect Runs `git ls-files`. */
function trackedFiles(): readonly string[] {
    return execFileSync('git', ['ls-files', '-z', '--', 'docs/design/canvases'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\0')
        .filter((line) => line !== '')
        .map((line) => line.slice('docs/design/canvases/'.length));
}

/** @sideEffect Reads `registry.json`. */
function registryClaims(): readonly { readonly id: string; readonly folder?: string }[] {
    return registrySchema
        .parse(JSON.parse(readFileSync(join(CANVAS_DIR, 'registry.json'), 'utf8')))
        .canvases.map(({ id, folder }) => (folder === undefined ? { id } : { id, folder }));
}

const folderOf = (file: string): string | undefined =>
    file.split('/')[1] === undefined ? undefined : file.split('/')[0];

describe('the design canvas folders', () => {
    const files = trackedFiles();
    const folders = [...new Set(files.flatMap((file) => folderOf(file) ?? []))];

    it('claims every folder once, and has a folder for every claim', () => {
        expect(claimProblems(folders, registryClaims())).toEqual([]);
    });

    it('tracks only the files a folder is allowed to hold', () => {
        expect(trackedFileProblems(files)).toEqual([]);
    });

    it('has a snapshot.json and a canvas.json in every folder', () => {
        expect(folders.flatMap((folder) => requiredFileProblems(folder, files))).toEqual([]);
    });

    it('places every board in canvas.json, and every name there exists', () => {
        const problems = folders.flatMap((folder) => {
            const parsed = canvasJsonSchema.safeParse(
                JSON.parse(readFileSync(join(CANVAS_DIR, folder, 'project', 'canvas.json'), 'utf8')),
            );
            const projectFiles = files
                .map((file) => PROJECT_FILE.exec(file))
                .filter((match) => match?.[1] === folder)
                .map((match) => match?.[2] ?? '');

            return parsed.success
                ? canvasJsonProblems(folder, parsed.data, projectFiles)
                : [`${folder}: canvas.json: ${parsed.error.message}`];
        });

        expect(problems).toEqual([]);
    });

    it('parses every snapshot.json', () => {
        const problems = folders.flatMap((folder) =>
            z
                .object({ url: z.string() })
                .safeParse(JSON.parse(readFileSync(join(CANVAS_DIR, folder, 'snapshot.json'), 'utf8'))).success
                ? []
                : [`${folder}: snapshot.json has no url`],
        );

        expect(problems).toEqual([]);
    });

    it('holds every html file to the html-validate tree rules, up to the measured allowance', async () => {
        const htmlFiles = files.filter((file) => file.endsWith('.html'));
        expect(htmlFiles.length).toBeGreaterThan(0);

        const found: Record<string, number> = {};

        for (const file of htmlFiles) {
            for (const rule of await treeFindingRules(readFileSync(join(CANVAS_DIR, file), 'utf8'))) {
                found[rule] = (found[rule] ?? 0) + 1;
            }
        }

        expect(found).toEqual(
            Object.fromEntries(
                Object.entries(ALLOWED_TREE_FINDINGS)
                    .filter(([, { count }]) => count > 0)
                    .map(([rule, { count }]) => [rule, count]),
            ),
        );
    }, 120_000);

    const assetFiles = files.filter((file) => /^[^/]+\/project\/assets\/[^/]+$/u.test(file));

    it('has image files to guard', () => {
        expect(assetFiles.length).toBeGreaterThan(0);
    });

    it('holds no /_blob/ reference in any tracked file', () => {
        const texts = new Map(
            files
                .filter((file) => !assetFiles.includes(file) && file !== 'README.md')
                .map((file) => [file, readFileSync(join(CANVAS_DIR, file), 'latin1')] as const),
        );

        expect(blobReferenceProblems(texts)).toEqual([]);
    });

    it('ties every board image to a tracked asset, and every asset to a board', () => {
        const problems = folders.flatMap((folder) => {
            const prefix = `${folder}/project/`;
            const boards = new Map(
                files
                    .filter((file) => file.startsWith(prefix) && file.endsWith('.html'))
                    .map((file) => [file.slice(prefix.length), readFileSync(join(CANVAS_DIR, file), 'utf8')] as const),
            );
            const assets = assetFiles
                .filter((file) => file.startsWith(`${prefix}assets/`))
                .map((file) => file.slice(`${prefix}assets/`.length));

            return assetReferenceProblems(folder, boards, assets);
        });

        expect(problems).toEqual([]);
    });

    it('keeps every asset in the index as an LFS pointer', () => {
        expect(lfsPointerProblems(indexBlobs(assetFiles.map((file) => `docs/design/canvases/${file}`)))).toEqual([]);
    });

    it('stores exactly the canvas assets with LFS, and nothing else in the repo', () => {
        const lfs = execFileSync('git', ['ls-files', '-z', ':(attr:filter=lfs)'], { cwd: REPO_ROOT, encoding: 'utf8' })
            .split('\0')
            .filter((line) => line !== '');

        expect(
            lfsScopeProblems(
                assetFiles.map((file) => `docs/design/canvases/${file}`),
                lfs,
            ),
        ).toEqual([]);
    });

    it('runs git lfs pre-push from the husky pre-push hook', () => {
        const hook = join(REPO_ROOT, '.husky', 'pre-push');

        expect(prePushHookProblems(existsSync(hook) ? readFileSync(hook, 'utf8') : null)).toEqual([]);
    });

    it('tokenizes every html file with only the named parse5 errors', () => {
        const htmlFiles = files.filter((file) => file.endsWith('.html'));
        // A path filter that matched nothing would pass without reading a file.
        expect(htmlFiles.length).toBeGreaterThan(0);

        const problems = htmlFiles.flatMap((file) =>
            htmlProblems(file, readFileSync(join(CANVAS_DIR, file), 'utf8'), Object.keys(ALLOWED_PARSE_ERRORS)),
        );

        expect(problems).toEqual([]);
    });
});

describe('claimProblems', () => {
    it('accepts one claim per folder', () => {
        expect(claimProblems(['a'], [{ id: 'x', folder: 'a' }, { id: 'ds' }])).toEqual([]);
    });

    it('reports an unclaimed folder, a doubly claimed folder and a claim with no folder', () => {
        expect(
            claimProblems(
                ['a', 'b'],
                [
                    { id: 'x', folder: 'a' },
                    { id: 'y', folder: 'a' },
                    { id: 'z', folder: 'c' },
                ],
            ),
        ).toEqual([
            'a: the folder is not claimed by exactly one registry entry',
            'b: the folder is not claimed by exactly one registry entry',
            'z: its folder c does not exist',
        ]);
    });
});

describe('trackedFileProblems', () => {
    it('accepts the allowed files', () => {
        expect(
            trackedFileProblems([
                'README.md',
                'registry.json',
                'a/snapshot.json',
                'a/project/canvas.json',
                'a/project/x/y.css',
            ]),
        ).toEqual([]);
    });

    it('refuses the marker, artifact-type, index.html and a stray file', () => {
        expect(
            trackedFileProblems([
                'a/project/published.json',
                'a/artifact-type/dc-runtime.js',
                'a/index.html',
                'notes.txt',
            ]),
        ).toEqual([
            'a/project/published.json: the publish marker is never committed',
            'a/artifact-type/dc-runtime.js: not README.md, registry.json, <folder>/snapshot.json or <folder>/project/**',
            'a/index.html: not README.md, registry.json, <folder>/snapshot.json or <folder>/project/**',
            'notes.txt: not README.md, registry.json, <folder>/snapshot.json or <folder>/project/**',
            'a/artifact-type/dc-runtime.js: artifact-type/ is not ours',
        ]);
    });
});

describe('requiredFileProblems', () => {
    it('accepts a folder with both files and names what is missing otherwise', () => {
        expect(requiredFileProblems('a', ['a/snapshot.json', 'a/project/canvas.json'])).toEqual([]);
        expect(requiredFileProblems('a', ['a/project/canvas.json'])).toEqual(['a/snapshot.json: missing']);
        expect(requiredFileProblems('a', [])).toEqual(['a/snapshot.json: missing', 'a/project/canvas.json: missing']);
    });
});

describe('canvasJsonProblems', () => {
    const board = { w: 1, h: 1 };

    it('accepts a canvas that places every board', () => {
        expect(
            canvasJsonProblems('a', { boards: { 'X.dc.html': board }, order: ['X.dc.html'] }, ['X.dc.html', 'a.css']),
        ).toEqual([]);
    });

    it('reports a missing board, a missing order entry and an unplaced board', () => {
        expect(
            canvasJsonProblems('a', { boards: { 'Gone.dc.html': board }, order: ['Gone2.dc.html'] }, ['Loose.dc.html']),
        ).toEqual([
            'a: boards names Gone.dc.html, which is missing',
            'a: order names Gone2.dc.html, which is missing',
            'a: Loose.dc.html is not placed in canvas.json',
        ]);
    });
});

describe('treeFindingRules', () => {
    it('accepts well-formed markup', async () => {
        expect(await treeFindingRules('<div><p id="a">x</p><p id="b">y</p></div>')).toEqual([]);
    });

    // Each of these tokenizes without a parse5 error, which is why the tree rules exist.
    const PRELUDE = '<!doctype html><title>t</title>';

    it.each([
        ['a closing tag that matches nothing', '<div></span></div>', 'close-order'],
        ['a block inside a paragraph', '<p><div>x</div></p>', 'close-order'],
        ['a div inside a table', '<table><div>x</div></table>', 'element-permitted-content'],
        ['a link inside a link', '<a href="/a"><a href="/b">x</a></a>', 'element-permitted-content'],
        ['a repeated id', '<p id="a">x</p><p id="a">y</p>', 'no-dup-id'],
    ])('names %s', async (_name, body, rule) => {
        expect(parseErrorCodes(PRELUDE + body)).toEqual([]);
        expect(await treeFindingRules(body)).toContain(rule);
    });
});

describe('htmlProblems', () => {
    it('accepts well-formed markup', () => {
        expect(
            htmlProblems('x.html', '<!doctype html><html><head><title>t</title></head><body></body></html>', []),
        ).toEqual([]);
    });

    // parse5 reports tokenizer errors (a repeated attribute) but not tree-construction ones (a stray closing tag).
    it('reports a parse error that is not allowed, and accepts it once it is', () => {
        const broken = '<!doctype html><title>t</title><a b="1" b="2">';

        expect(htmlProblems('x.html', broken, [])).toEqual(['x.html: parse error duplicate-attribute']);
        expect(htmlProblems('x.html', broken, ['duplicate-attribute'])).toEqual([]);
    });
});

describe('trackedFileProblems and images', () => {
    it('accepts an image under project/assets/ and still refuses the marker', () => {
        expect(
            trackedFileProblems(['a/project/assets/0123456789abcdef.webp', 'a/project/assets/authFood.jpg']),
        ).toEqual([]);
    });
});

describe('blobReferenceProblems', () => {
    it('accepts text with no /_blob/ reference', () => {
        expect(blobReferenceProblems(new Map([['a/project/x.html', 'url(assets/0123456789abcdef.webp)']]))).toEqual([]);
    });

    it('names every file that still points at the host blob store', () => {
        expect(
            blobReferenceProblems(
                new Map([
                    ['a/project/x.html', '<img src="/_blob/abc">'],
                    ['a/project/y.html', 'fine'],
                ]),
            ),
        ).toEqual(['a/project/x.html: references /_blob/; images are canvas files under project/assets/ (ADR-0092)']);
    });
});

describe('assetReferenceProblems', () => {
    const FILE = '0123456789abcdef.webp';

    it('accepts boards whose every image exists and is used', () => {
        expect(
            assetReferenceProblems(
                'a',
                new Map([
                    ['x.dc.html', `<div style="background:url(assets/${FILE})"></div><img src='assets/authFood.jpg'>`],
                ]),
                [FILE, 'authFood.jpg'],
            ),
        ).toEqual([]);
    });

    it('reports a referenced image that is not tracked, in url(), quoted url() and src', () => {
        expect(
            assetReferenceProblems(
                'a',
                new Map([
                    [
                        'x.dc.html',
                        'url(assets/one.webp) url("assets/two.png") url(\'assets/three.jpg\') <img src="assets/four.gif">',
                    ],
                ]),
                [],
            ),
        ).toEqual([
            'a: x.dc.html references assets/one.webp, which is not tracked in project/assets/',
            'a: x.dc.html references assets/two.png, which is not tracked in project/assets/',
            'a: x.dc.html references assets/three.jpg, which is not tracked in project/assets/',
            'a: x.dc.html references assets/four.gif, which is not tracked in project/assets/',
        ]);
    });

    it('reports a tracked image no board uses', () => {
        expect(assetReferenceProblems('a', new Map([['x.dc.html', 'no images']]), [FILE])).toEqual([
            `a: assets/${FILE} is not referenced by any board`,
        ]);
    });

    it('counts a use in any board of the folder', () => {
        expect(
            assetReferenceProblems(
                'a',
                new Map([
                    ['x.dc.html', 'none'],
                    ['y.dc.html', `url(assets/${FILE})`],
                ]),
                [FILE],
            ),
        ).toEqual([]);
    });
});

describe('lfsPointerProblems', () => {
    const POINTER = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n';

    it('accepts an index blob that is a pointer', () => {
        expect(lfsPointerProblems(new Map([['a/project/assets/x.webp', POINTER]]))).toEqual([]);
    });

    it('names an index blob that holds the image itself', () => {
        expect(lfsPointerProblems(new Map([['a/project/assets/x.webp', 'RIFF....WEBP']]))).toEqual([
            'a/project/assets/x.webp: the index holds the image, not an LFS pointer; run git add --renormalize a/project/assets/x.webp',
        ]);
    });
});

describe('lfsScopeProblems', () => {
    it('accepts LFS exactly on the tracked asset files', () => {
        expect(lfsScopeProblems(['a/project/assets/x.webp'], ['a/project/assets/x.webp'])).toEqual([]);
    });

    it('reports an asset that is not LFS and an LFS file that is not an asset', () => {
        expect(lfsScopeProblems(['a/project/assets/x.webp'], ['b/project/assets/y.png', 'big.zip'])).toEqual([
            'a/project/assets/x.webp: a canvas asset that .gitattributes does not store with LFS',
            'b/project/assets/y.png: stored with LFS, but only canvas assets may be (ADR-0092)',
            'big.zip: stored with LFS, but only canvas assets may be (ADR-0092)',
        ]);
    });
});

describe('prePushHookProblems', () => {
    it('accepts a hook that runs git lfs pre-push with the hook arguments', () => {
        expect(prePushHookProblems('#!/bin/sh\nexec git lfs pre-push "$@"\n')).toEqual([]);
    });

    it('reports a missing hook and a hook that never calls LFS', () => {
        expect(prePushHookProblems(null)).toEqual(['.husky/pre-push: missing; images would be pushed as pointers']);
        expect(prePushHookProblems('#!/bin/sh\nexit 0\n')).toEqual([
            '.husky/pre-push: does not run `git lfs pre-push "$@"`',
        ]);
    });
});
