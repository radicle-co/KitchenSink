/**
 * The seed manifest over a real filesystem (curated catalog plan U2, R8, KTD-4).
 *
 * `readSeedManifest` names a whole bundle tree with one digest, and `assertSeedBundleMatches` is what the seed
 * function runs before it applies anything. This suite walks real temporary directories: symlinks, special files,
 * modes and modification times are properties of a filesystem that no in-memory stand-in reproduces. It touches no
 * database and no service.
 *
 * The expected text is built here from `node:crypto` directly, not through the module under test; the shell half's
 * agreement is `packages/infra/global/__tests__/seedManifestAgreement.test.ts`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
    SeedBundleRefusedError,
    SeedManifestMismatchError,
    isSeedBundleRefusedError,
    isSeedManifestMismatchError,
} from '../src/errors.js';
import { assertSeedBundleMatches, readSeedManifest } from '../src/seedManifestFile.js';

const scratch = mkdtempSync(join(tmpdir(), 'seedManifest-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

/** Write a tree of `path → content` under a fresh directory, in the given order, and return its root. */
function tree(files: readonly (readonly [string, string])[]): string {
    const root = mkdtempSync(join(scratch, 'tree-'));

    for (const [path, content] of files) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }

    return root;
}

const BUNDLE = [
    ['handler.js', 'export const handler = () => 1;\n'],
    ['data/curatedCatalog.jsonl', '{"key":"apple"}\n'],
    ['data/usda/sourcePins.json', '{"srLegacy":{}}\n'],
] as const;

/** The refusal a call raises, or a failure naming what it returned instead. */
function refusalOf(call: () => unknown): SeedBundleRefusedError {
    try {
        call();
    } catch (error) {
        if (isSeedBundleRefusedError(error)) {
            return error;
        }

        throw error;
    }

    throw new Error('expected a SeedBundleRefusedError, but the call returned');
}

describe('readSeedManifest', () => {
    it('renders every regular file, C-ordered by its bundle-relative path, and digests that text', () => {
        const manifest = readSeedManifest(tree(BUNDLE));
        const expected = [...BUNDLE]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([path, content]) => `${sha256(content)}  ${path}\n`)
            .join('');

        expect(manifest.files).toStrictEqual(['data/curatedCatalog.jsonl', 'data/usda/sourcePins.json', 'handler.js']);
        expect(manifest.text).toBe(expected);
        expect(manifest.sha).toBe(sha256(expected));
    });

    it('ignores creation order, modification time and file mode', () => {
        const reordered = tree([...BUNDLE].reverse());

        utimesSync(join(reordered, 'handler.js'), new Date('2001-01-01'), new Date('2001-01-01'));
        chmodSync(join(reordered, 'data/curatedCatalog.jsonl'), 0o600);

        expect(readSeedManifest(reordered).sha).toBe(readSeedManifest(tree(BUNDLE)).sha);
    });

    it.each([
        ['one changed byte in a nested data file', [['data/curatedCatalog.jsonl', '{"key":"applf"}\n']]],
        ['one changed byte in the handler', [['handler.js', 'export const handler = () => 2;\n']]],
        [
            'a renamed file',
            [
                ['data/curatedCatalog.jsonl', undefined],
                ['data/catalog.jsonl', '{"key":"apple"}\n'],
            ],
        ],
        ['an added empty file', [['data/.keep', '']]],
    ] as const)('changes the digest for %s', (_case, edits) => {
        const files = new Map<string, string>(BUNDLE);

        for (const [path, content] of edits) {
            if (content === undefined) {
                files.delete(path);
            } else {
                files.set(path, content);
            }
        }

        expect(readSeedManifest(tree([...files])).sha).not.toBe(readSeedManifest(tree(BUNDLE)).sha);
    });

    it('does not change the digest for an added empty directory — a directory is not an entry', () => {
        const withDirectory = tree(BUNDLE);

        mkdirSync(join(withDirectory, 'data/empty'));

        expect(readSeedManifest(withDirectory).sha).toBe(readSeedManifest(tree(BUNDLE)).sha);
    });

    it('⛔ refuses a root that does not exist, and a file passed as the root', () => {
        const file = join(tree(BUNDLE), 'handler.js');

        expect(refusalOf(() => readSeedManifest(join(scratch, 'absent')))).toMatchObject({ reason: 'missing' });
        expect(refusalOf(() => readSeedManifest(file))).toMatchObject({ reason: 'notADirectory' });
    });

    it('⛔ refuses a tree holding only empty directories — an empty bundle proves nothing', () => {
        const root = mkdtempSync(join(scratch, 'empty-'));

        mkdirSync(join(root, 'data/usda'), { recursive: true });

        expect(refusalOf(() => readSeedManifest(root))).toMatchObject({ reason: 'empty', paths: [] });
    });

    it('⛔ refuses file and directory symlinks, naming every one', () => {
        const root = tree(BUNDLE);

        symlinkSync(join(root, 'handler.js'), join(root, 'data/handlerLink.js'));
        symlinkSync(join(root, 'data'), join(root, 'dataLink'));

        expect(refusalOf(() => readSeedManifest(root))).toMatchObject({
            reason: 'symlink',
            paths: ['data/handlerLink.js', 'dataLink'],
        });
    });

    it('⛔ refuses a special file', () => {
        const root = tree(BUNDLE);

        execFileSync('mkfifo', [join(root, 'data/pipe')]);

        expect(refusalOf(() => readSeedManifest(root))).toMatchObject({ reason: 'specialFile', paths: ['data/pipe'] });
    });

    it('⛔ refuses every path outside the contract, naming each', () => {
        const root = tree([
            ...BUNDLE,
            ['data/a b.json', '1'],
            ['data/new\nline.json', '2'],
            ['data/back\\slash.json', '3'],
            ['data/naïve.json', '4'],
        ]);

        expect(refusalOf(() => readSeedManifest(root))).toMatchObject({
            reason: 'unsafePath',
            paths: ['data/a b.json', 'data/back\\slash.json', 'data/naïve.json', 'data/new\nline.json'],
        });
    });

    it('accepts the real committed seed data', () => {
        const data = fileURLToPath(new URL('../../../services/food-service/src/foods/seed/data', import.meta.url));

        expect(readSeedManifest(data).files.length).toBeGreaterThanOrEqual(8);
    });
});

describe('assertSeedBundleMatches', () => {
    it('returns the manifest when the bundle is the one the caller expected', () => {
        const root = tree(BUNDLE);
        const expected = readSeedManifest(root).sha;

        expect(assertSeedBundleMatches({ label: 'Food', bundleDir: root, expectSeedSha: expected }).sha).toBe(expected);
    });

    it('⛔ refuses a different bundle, carrying both digests and the files it holds', () => {
        const root = tree(BUNDLE);
        let caught: unknown;

        try {
            assertSeedBundleMatches({ label: 'Food', bundleDir: root, expectSeedSha: 'b'.repeat(64) });
        } catch (error) {
            caught = error;
        }

        expect(isSeedManifestMismatchError(caught)).toBe(true);
        expect(caught as SeedManifestMismatchError).toMatchObject({
            expected: 'b'.repeat(64),
            actual: readSeedManifest(root).sha,
            files: readSeedManifest(root).files,
        });
    });

    it('⛔ refuses a malformed expectation before reading anything', () => {
        expect(() =>
            assertSeedBundleMatches({ label: 'Food', bundleDir: join(scratch, 'absent'), expectSeedSha: 'x' }),
        ).toThrow(/expectSeedSha/u);
    });
});
