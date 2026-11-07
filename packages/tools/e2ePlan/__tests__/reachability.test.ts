import { describe, expect, it } from 'vitest';

import { reach, type Terminals } from '../src/reachability.js';

/** `importers[x]` lists the files that import x. */
const graphOf =
    (importers: Readonly<Record<string, readonly string[]>>) =>
    (file: string): readonly string[] =>
        importers[file] ?? [];

const terminals: Terminals = {
    screenEntries: new Map([
        ['pageA', ['/a']],
        ['pageB', ['/b']],
        ['layoutAB', ['/a', '/b']],
    ]),
    roots: new Set(['root']),
    tests: new Map([['specA', 'a.spec.ts']]),
};

describe('reach', () => {
    it('finds the screen a leaf feeds', () => {
        const result = reach('leaf', graphOf({ leaf: ['mid'], mid: ['pageA'] }), terminals);

        expect([...result.screens]).toEqual(['/a']);
        expect(result.roots).toEqual([]);
    });

    it('finds every screen a shared file feeds, and a layout feeds all its screens', () => {
        const result = reach('shared', graphOf({ shared: ['pageA', 'pageB'] }), terminals);

        expect([...result.screens].sort()).toEqual(['/a', '/b']);
        expect([...reach('layoutAB', graphOf({}), terminals).screens].sort()).toEqual(['/a', '/b']);
    });

    it('reports a root, which means the whole app', () => {
        expect(reach('leaf', graphOf({ leaf: ['root'] }), terminals).roots).toEqual(['root']);
    });

    it('reports a test that imports the file, and a test that is the file', () => {
        expect([...reach('util', graphOf({ util: ['specA'] }), terminals).tests]).toEqual(['a.spec.ts']);
        expect([...reach('specA', graphOf({}), terminals).tests]).toEqual(['a.spec.ts']);
    });

    it('does not climb from a screen into the root that registers it', () => {
        const result = reach('leaf', graphOf({ leaf: ['pageA'], pageA: ['root'] }), terminals);

        expect([...result.screens]).toEqual(['/a']);
        expect(result.roots).toEqual([]);
    });

    it('does climb from a screen into a screen that embeds it', () => {
        const result = reach('leaf', graphOf({ leaf: ['pageA'], pageA: ['pageB', 'root'] }), terminals);

        expect([...result.screens].sort()).toEqual(['/a', '/b']);
    });

    it('terminates on an import cycle', () => {
        const result = reach('x', graphOf({ x: ['y'], y: ['x', 'pageA'] }), terminals);

        expect([...result.screens]).toEqual(['/a']);
    });

    it('reaches nothing for a file nobody imports', () => {
        const result = reach('orphan', graphOf({}), terminals);

        expect(result.screens.size + result.tests.size + result.roots.length).toBe(0);
    });
});
