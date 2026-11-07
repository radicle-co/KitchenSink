/**
 * A FlashList whose `numColumns` or layout variant can change carries a `key` that changes with it — fixture rows for
 * the detector in `nativeFlashListKeys.ts`.
 *
 * ⛔ WHY. FlashList measures cells once and recycles them, so a new column count under a mounted list draws blank
 * slots until it is remounted. The Recipes grid shipped that defect and a device found it. The rows below are the
 * shapes the tree has, the shapes that fix them, and the shapes the reader cannot see (which must be findings).
 *
 * The tree is asserted at the end, and the rows `reads the real lists` pin that the reader finds them, so that assertion
 * cannot pass vacuously.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { flashListSites, unkeyedFlashLists } from './nativeFlashListKeys.js';
import { nativeSources } from './nativeSources.js';
import { repoRoot } from './serviceSources.js';

const FL = `import { FlashList } from '@shopify/flash-list';`;

/** [what the shape is, the module text, the number of findings it must produce]. */
const SHAPES: readonly (readonly [string, string, number])[] = [
    [
        'numColumns from a variable, no key (the blank-slot defect)',
        `${FL} const A = ({ c }) => <FlashList numColumns={c} data={[]} />;`,
        1,
    ],
    [
        'numColumns from a variable, keyed by it',
        `${FL} const A = ({ c }) => <FlashList key={c} numColumns={c} data={[]} />;`,
        0,
    ],
    [
        'numColumns from a variable, keyed by a template that holds it',
        `${FL} const A = ({ c, v }) => <FlashList key={\`\${v}-\${String(c)}\`} numColumns={c} data={[]} />;`,
        0,
    ],
    [
        'numColumns from a variable, keyed by something else',
        `${FL} const A = ({ c, other }) => <FlashList key={other} numColumns={c} data={[]} />;`,
        1,
    ],
    ['numColumns a literal, no key', `${FL} const A = () => <FlashList numColumns={2} data={[]} />;`, 0],
    ['no numColumns, no key', `${FL} const A = () => <FlashList data={[]} />;`, 0],
    [
        'numColumns from a call: the data it reads must be keyed, the function name need not',
        `${FL} const A = ({ w }) => <FlashList key={w} numColumns={columnsOf(w)} data={[]} />;`,
        0,
    ],
    [
        'numColumns from a call, the width not keyed',
        `${FL} const A = ({ w }) => <FlashList numColumns={columnsOf(w)} data={[]} />;`,
        1,
    ],
    [
        'a separator that switches on the variant, variant not in the key',
        `${FL} const A = ({ v, c }) => <FlashList key={c} numColumns={c} ItemSeparatorComponent={v === 'row' ? Row : Grid} data={[]} />;`,
        1,
    ],
    [
        'a separator that switches on the variant, variant in the key',
        `${FL} const A = ({ v, c }) => <FlashList key={\`\${v}-\${c}\`} numColumns={c} ItemSeparatorComponent={v === 'row' ? Row : Grid} data={[]} />;`,
        0,
    ],
    [
        'a separator that switches, no numColumns, no key',
        `${FL} const A = ({ v }) => <FlashList ItemSeparatorComponent={v ? Row : Grid} data={[]} />;`,
        1,
    ],
    [
        'a render function with a conditional inside is rendering, not layout',
        `${FL} const A = () => <FlashList renderItem={({ item }) => (item.big ? <Big /> : <Small />)} data={[]} />;`,
        0,
    ],
    [
        'a render function chosen by a condition',
        `${FL} const A = ({ v }) => <FlashList renderItem={v ? renderRow : renderCard} data={[]} />;`,
        1,
    ],
    ['horizontal from a variable, no key', `${FL} const A = ({ h }) => <FlashList horizontal={h} data={[]} />;`, 1],
    ['horizontal literal', `${FL} const A = () => <FlashList horizontal data={[]} />;`, 0],
    [
        'a spread with no explicit numColumns cannot be read, so it is a finding',
        `${FL} const A = (props) => <FlashList {...props} data={[]} />;`,
        1,
    ],
    [
        'a spread AFTER numColumns may override it, so it is a finding',
        `${FL} const A = (props, { c }) => <FlashList key={c} numColumns={c} {...props} data={[]} />;`,
        1,
    ],
    [
        'a spread BEFORE an explicit numColumns cannot override it (the house scroll bind)',
        `${FL} const A = ({ c, bind }) => <FlashList key={c} {...bind} numColumns={c} data={[]} />;`,
        0,
    ],
    [
        'a spread BEFORE numColumns, the key missing: still the missing key',
        `${FL} const A = ({ c, bind }) => <FlashList {...bind} numColumns={c} data={[]} />;`,
        1,
    ],
    [
        'a renamed import is still read',
        `import { FlashList as Grid } from '@shopify/flash-list'; const A = ({ c }) => <Grid numColumns={c} data={[]} />;`,
        1,
    ],
    [
        'a namespace import is still read',
        `import * as FlashListLib from '@shopify/flash-list'; const A = ({ c }) => <FlashListLib.FlashList numColumns={c} data={[]} />;`,
        1,
    ],
    [
        'a FlashList from another package is not read',
        `import { FlashList } from 'somewhere-else'; const A = ({ c }) => <FlashList numColumns={c} data={[]} />;`,
        0,
    ],
    [
        'two lists in one module are each read',
        `${FL} const A = ({ c, d }) => (<><FlashList key={c} numColumns={c} data={[]} /><FlashList numColumns={d} data={[]} /></>);`,
        1,
    ],
];

describe('unkeyedFlashLists — fixture rows', () => {
    it.each(SHAPES)('%s', (_name, source, expected) => {
        expect(unkeyedFlashLists(source, 'Fixture.native.tsx')).toHaveLength(expected);
    });

    it('names the line and what the key lacks', () => {
        const findings = unkeyedFlashLists(
            `${FL}\nconst A = ({ v, c }) => (\n<FlashList key={c} numColumns={c} ItemSeparatorComponent={v ? Row : Grid} data={[]} />\n);`,
            'Fixture.native.tsx',
        );

        expect(findings).toEqual(['3: the key does not change with v']);
    });
});

describe('flashListSites — the reader finds the real lists', () => {
    const REAL_LISTS = [
        'packages/apps/commise/features/recipes/src/list/RecipeListResults.native.tsx',
        'packages/apps/commise/features/recipes/src/discovery/RecipeDiscoveryResults.native.tsx',
        'packages/apps/commise/features/recipes/src/collections/CollectionListResults.native.tsx',
    ] as const;

    it.each(REAL_LISTS)('reads the list in %s', (file) => {
        expect(flashListSites(readFileSync(path.join(repoRoot, file), 'utf8'), file)).toBeGreaterThan(0);
    });
});

describe('the tree — every FlashList that can change layout is keyed by it', () => {
    it('has no list without such a key, and no spread this reader cannot place', () => {
        const findings = nativeSources().flatMap((file) =>
            unkeyedFlashLists(readFileSync(path.join(repoRoot, file), 'utf8'), file).map(
                (finding) => `${file}:${finding}`,
            ),
        );

        expect(findings).toEqual([]);
    });
});
