/**
 * No native component reads the elevation table itself: a shadow is an `Elevated` (`ui/src/elevation`). Five components
 * spread `nativeTokens.elevation.<level>` into their own style, which draws a shadow the theme cannot recolour and, on
 * Android, only on the view that carries the fill; they were moved onto `Elevated`, and this guard stops a sixth from
 * coming back the next time someone copies a card. Asserted by DISCOVERY over every app source, never by a list.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules } from './appSources.js';
import { elevationTableReads } from './nativeElevationReads.js';
import { repoRoot } from './serviceSources.js';

const FILE = 'packages/apps/commise/features/recipes/src/card/Thing.native.tsx';

/** [what the shape is, the module text, the number of reads it must produce]. */
const SHAPES: readonly (readonly [string, string, number])[] = [
    ['a spread of a level into a style', `const s = { ...nativeTokens.elevation.sm };`, 1],
    ['a spread inside a StyleSheet', `const s = StyleSheet.create({ a: { ...nativeTokens.elevation.lg } });`, 1],
    ['a read through a string key', `const e = nativeTokens['elevation'];`, 1],
    ['a destructured table', `const { elevation } = nativeTokens;`, 1],
    ['a renamed destructure', `const { elevation: table } = nativeTokens;`, 1],
    ['two reads', `const a = nativeTokens.elevation.sm; const b = nativeTokens.elevation.md;`, 2],
    ['another token group', `const r = nativeTokens.radius.md;`, 0],
    ['a different object with an elevation field', `const e = theme.elevation;`, 0],
    ['a comment that names the table', `// nativeTokens.elevation.sm\nconst a = 1;`, 0],
    ['a string that names the table', `const a = 'nativeTokens.elevation.sm';`, 0],
];

describe('elevationTableReads', () => {
    it.each(SHAPES)('%s', (_name, source, reads) => {
        expect(elevationTableReads(FILE, source)).toHaveLength(reads);
    });

    it('lets the modules that own the table read it', () => {
        const source = `const { elevation } = nativeTokens; const b = nativeTokens.elevation.sm;`;

        for (const owner of [
            'packages/apps/commise/ui/src/elevation/Elevated.native.tsx',
            'packages/apps/commise/ui/src/tokens/native.ts',
            'packages/apps/commise/ui/src/theme/tamaguiThemes.ts',
            'packages/apps/commise/ui/src/testing/elevationShadow.ts',
        ]) {
            expect(elevationTableReads(owner, source)).toStrictEqual([]);
        }
    });

    it('names the line of a read', () => {
        expect(elevationTableReads(FILE, `const a = 1;\nconst b = nativeTokens.elevation.sm;`)).toStrictEqual([
            `${FILE}:2`,
        ]);
    });
});

describe('the app sources', () => {
    it('read the elevation table nowhere outside the modules that own it', () => {
        const sources = appSourceModules();
        const reads = sources.flatMap((file) =>
            elevationTableReads(file, readFileSync(path.join(repoRoot, file), 'utf8')),
        );

        // The rows above prove the reader finds each shape, so an empty result here is a finding, not silence.
        expect(sources.length).toBeGreaterThan(500);
        expect(reads).toStrictEqual([]);
    });
});
