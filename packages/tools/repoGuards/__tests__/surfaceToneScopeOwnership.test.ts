/**
 * A surface states its tone ONCE (ADR-0080 §1, H3). `ToneScope` pairs Tamagui's `<Theme name>` with the JS tone context
 * (`SurfaceToneScope`), so a Tamagui part inside a surface sees the same tone a design-system reader does. A raw
 * `SurfaceToneScope` states only the JS half: a Tamagui part inside it would not see the tone. So only `ToneScope`
 * imports it.
 *
 * Three overlay roots predated `ToneScope` and sat on a closed list that could only shrink. Their ports to Tamagui's Sheet
 * and Dialog moved each to `ToneScope`, the list reached empty, and it was deleted with its last entry.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules } from './appSources.js';
import { repoRoot } from './serviceSources.js';
import { SURFACE_TONE_SCOPE_OWNER, surfaceToneScopeImports } from './surfaceToneScopeOwnership.js';

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

    it('is ToneScope, and nothing else', () => {
        expect(importers.filter((file) => file !== SURFACE_TONE_SCOPE_OWNER)).toEqual([]);
    });

    it('finds ToneScope itself importing it (a vacuous pass would hide the rule)', () => {
        expect(importers).toContain(SURFACE_TONE_SCOPE_OWNER);
    });
});
