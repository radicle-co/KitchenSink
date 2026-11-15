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
import { readFileSync } from 'node:fs';
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
 * The tree findings the published snapshot already carries, per rule, measured over all 3,217 html files. The files
 * must stay byte-identical to the live canvases, so they are counted rather than edited. The count is exact: a new
 * finding fails, and a fixed one forces this number down.
 */
const ALLOWED_TREE_FINDINGS: Readonly<Record<(typeof TREE_RULES)[number], { count: number; reason: string }>> = {
    'close-order': { count: 0, reason: 'measured: no finding' },
    'element-permitted-content': {
        count: 59,
        reason: 'the live boards put <p> (48) and <div> (2) inside <span>, and <div> (9) inside <button>',
    },
    'no-dup-id': { count: 25, reason: 'the live boards repeat an id inside one file' },
};

/**
 * The parse5 error codes the published canvases are allowed to raise, measured on the real snapshot. HTML parsing
 * never fails, so a clean tokenization is a statement about the markup: a code that is not named here is a new kind of
 * breakage. Each entry says why it is tolerated.
 */
const ALLOWED_PARSE_ERRORS: Readonly<Record<string, string>> = {}; // measured: 0 errors over all 3,217 files

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
