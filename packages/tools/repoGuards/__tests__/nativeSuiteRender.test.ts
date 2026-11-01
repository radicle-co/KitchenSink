/**
 * Every native component suite in the features and the mobile app renders inside the design system (the Tamagui
 * provider, its config and its theme), as the app does: it imports `render` from `@commise/ui/testing/tamagui`, not
 * Testing Library's own. Without it, a suite of any screen that draws a design-system Tamagui component fails with
 * "no config is available" or "Missing theme" the day that component is ported (H-1 moved Button and FieldLabel, and 66
 * suites broke at once). The one opt-out is named where it is used: `render as renderUnscoped`, for a suite whose
 * subject mounts the design-system provider itself (`AppProviders`), which an outer one would mask.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules } from './appSources.js';
import { unscopedRenders } from './nativeSuiteRender.js';
import { repoRoot } from './serviceSources.js';

const SUITE = 'packages/apps/commise/features/recipes/src/thing/__tests__/Thing.native.test.tsx';

describe('unscopedRenders', () => {
    it.each([
        ["Testing Library's render", "import { cleanup, render, screen } from '@testing-library/react';", 1],
        ["Testing Library's render, renamed", "import { render as draw } from '@testing-library/react';", 1],
        ['a namespace import, whose render no reader can see', "import * as RTL from '@testing-library/react';", 1],
        ['the named opt-out', "import { render as renderUnscoped } from '@testing-library/react';", 0],
        ["the design system's render", "import { render } from '@commise/ui/testing/tamagui';", 0],
        ['Testing Library without render', "import { cleanup, screen } from '@testing-library/react';", 0],
        ['a type-only import', "import type { RenderResult } from '@testing-library/react';", 0],
    ] as const)('%s → %i', (_shape, source, count) => {
        expect(unscopedRenders(source, SUITE)).toHaveLength(count);
    });

    it('holds for every native suite in the features and the mobile app', () => {
        const suites = appSourceModules(
            ['packages/apps/commise/features', 'packages/apps/commise/mobile'],
            /(?:^|\/)(?:node_modules|dist)\//u,
        ).filter((file) => file.endsWith('.native.test.tsx'));

        // The scan reads files; an empty list means discovery broke, which would pass vacuously.
        expect(suites.length).toBeGreaterThan(100);

        const findings = suites.flatMap((file) =>
            unscopedRenders(readFileSync(path.join(repoRoot, file), 'utf8'), file),
        );

        expect(findings).toEqual([]);
    });
});
