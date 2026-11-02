/**
 * A surface states its tone ONCE (ADR-0080 §1, H3). `ToneScope` pairs Tamagui's `<Theme name>` with the JS tone context
 * (`SurfaceToneScope`), so a Tamagui part inside a surface sees the same tone a design-system reader does. A raw
 * `SurfaceToneScope` states only the JS half: a Tamagui part inside it would not see the tone. So only `ToneScope`
 * imports it.
 *
 * The three overlay roots that predate `ToneScope` are on a closed list that can only shrink: their port to Tamagui's
 * Sheet and Dialog moves each to `ToneScope`, and a stale entry fails here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules } from './appSources.js';
import { repoRoot } from './serviceSources.js';
import {
    SURFACE_TONE_SCOPE_OWNER,
    SURFACE_TONE_SCOPE_PENDING,
    surfaceToneScopeImports,
} from './surfaceToneScopeOwnership.js';

const UI = 'packages/apps/commise/ui/src/';

describe('surfaceToneScopeImports', () => {
    it.each([
        ['a named import', `import { SurfaceToneScope } from '../surfaceTone/surfaceToneContext.js';`, 1],
        ['a renamed import', `import { SurfaceToneScope as Scope } from './surfaceToneContext.js';`, 1],
        [
            'a namespace member',
            `import * as C from './surfaceToneContext.js';\nconst x = <C.SurfaceToneScope tone="paper" />;`,
            1,
        ],
        ['the hook from the same module', `import { useSurfaceTone } from '../surfaceTone/surfaceToneContext.js';`, 0],
        ['a type-only import', `import type { SurfaceToneScope } from './surfaceToneContext.js';`, 0],
        ['a same-named export from elsewhere', `import { SurfaceToneScope } from './somewhereElse.js';`, 0],
        ['a re-export', `export { SurfaceToneScope } from './surfaceToneContext.js';`, 1],
    ] as const)('%s', (_shape, source, expected) => {
        expect(surfaceToneScopeImports(source, `${UI}x/X.native.tsx`)).toHaveLength(expected);
    });
});

describe('who may import SurfaceToneScope', () => {
    const importers = appSourceModules()
        .filter((file) => surfaceToneScopeImports(readFileSync(path.join(repoRoot, file), 'utf8'), file).length > 0)
        .filter((file) => !file.endsWith('/surfaceToneContext.ts'));

    it('is ToneScope, and the closed pending list, and nothing else', () => {
        expect(
            importers.filter((file) => file !== SURFACE_TONE_SCOPE_OWNER && !SURFACE_TONE_SCOPE_PENDING.includes(file)),
        ).toEqual([]);
    });

    it('finds ToneScope itself importing it (a vacuous pass would hide the rule)', () => {
        expect(importers).toContain(SURFACE_TONE_SCOPE_OWNER);
    });

    it('has no stale entry: every pending file still imports it', () => {
        expect(SURFACE_TONE_SCOPE_PENDING.filter((file) => !importers.includes(file))).toEqual([]);
    });

    it('names only the three overlay roots, so the list can only shrink', () => {
        expect([...SURFACE_TONE_SCOPE_PENDING].sort()).toEqual(
            [
                `${UI}dialogFrame/DialogFrame.native.tsx`,
                `${UI}sheet/BottomSheetPanel.native.tsx`,
                `${UI}sheet/FullScreenSheet.native.tsx`,
            ].sort(),
        );
    });
});
