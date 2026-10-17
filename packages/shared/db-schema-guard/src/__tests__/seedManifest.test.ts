/**
 * The seed manifest's path contract (curated catalog plan U2, KTD-4).
 *
 * The seed digest is computed twice, by `readSeedManifest` and by `runSeed.sh manifest`, and the two agree only if
 * they render every path the same way. The contract that makes that possible: every path segment is plain ASCII
 * from a small set, so a JavaScript string comparison sorts exactly as `LC_ALL=C sort` does, and `sha256sum` never
 * escapes a name. A path outside the contract is refused by both halves rather than digested two ways.
 */
import { describe, expect, it } from 'vitest';

import { formatManifest } from '../manifest.js';
import { isSeedManifestPath } from '../seedManifest.js';

describe('isSeedManifestPath', () => {
    it.each(['lambdas/seed/handler.js', 'data/usda/srLegacy201804.zip', '.keep', 'a-b_c.d/E9'])(
        'accepts %j',
        (path) => {
            expect(isSeedManifestPath(path)).toBe(true);
        },
    );

    it.each([
        ['an empty path', ''],
        ['an absolute path', '/a'],
        ['an empty segment', 'a//b'],
        ['a trailing slash', 'a/'],
        ['a `.` segment', './a'],
        ['a `..` segment', 'a/../b'],
        ['a space', 'a b'],
        ['a backslash, which sha256sum escapes', 'a\\b'],
        ['a newline, which sha256sum escapes', 'a\nb'],
        ['a non-ASCII letter, whose sort order depends on the locale', 'naïve.json'],
        ['a shell metacharacter', 'a$b'],
    ])('⛔ refuses %s', (_case, path) => {
        expect(isSeedManifestPath(path)).toBe(false);
    });
});

describe('formatManifest over seed paths', () => {
    it('orders entries exactly as `LC_ALL=C sort` does', () => {
        const names = ['data0', 'a_b', 'data/x', 'Data', 'a.b', 'data.json', 'a-b'];
        const rendered = formatManifest(names.map((name) => ({ name, sha256: '0'.repeat(64) })));

        expect(
            rendered
                .split('\n')
                .filter((line) => line !== '')
                .map((line) => line.slice(66)),
        ).toStrictEqual(['Data', 'a-b', 'a.b', 'a_b', 'data.json', 'data/x', 'data0']);
    });
});
