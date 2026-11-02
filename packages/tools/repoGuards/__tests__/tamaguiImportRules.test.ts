/**
 * Where Tamagui may be imported (ADR-0080).
 *
 * G1 — Tamagui stays out of web. The web app styles with Tailwind and never loads Tamagui, so `tamagui`, `@tamagui/*`
 * and `@commise/ui/tamagui-config` may be imported (as a value, a type, a re-export, a dynamic import or a `require`)
 * only by a `.native.ts(x)` leaf or by the mobile app.
 *
 * G2 — one theme hook. A component reads the theme through `@commise/ui/theme`, whose scheme reading is the one
 * `TamaguiProvider` is given. Tamagui's own `useTheme`, `useThemeName` and `getTokens` are a second reading of the
 * same state, so no app module imports them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules } from './appSources.js';
import { repoRoot } from './serviceSources.js';
import {
    tamaguiImportFindings,
    tamaguiThemeElementFindings,
    tamaguiThemeHookFindings,
    tamaguiUnclassifiedImportFindings,
} from './tamaguiImportRules.js';

const WEB_LEAF = 'packages/apps/commise/ui/src/thing/Thing.tsx';
const NATIVE_LEAF = 'packages/apps/commise/ui/src/thing/Thing.native.tsx';
const MOBILE = 'packages/apps/commise/mobile/src/screens/Home.tsx';

describe('G1: tamaguiImportFindings', () => {
    it.each([
        ['a web leaf importing tamagui', WEB_LEAF, `import { View } from 'tamagui';`, 1],
        ['a web leaf importing the config', WEB_LEAF, `import { tamaguiConfig } from '@commise/ui/tamagui-config';`, 1],
        [
            'a type-only import in a shared module',
            'packages/apps/commise/ui/src/x/x.ts',
            `import type { GetProps } from '@tamagui/web';`,
            1,
        ],
        ['a re-export', WEB_LEAF, `export { View } from 'tamagui';`, 1],
        ['a dynamic import', WEB_LEAF, `const t = import('tamagui');`, 1],
        ['a require', WEB_LEAF, `const t = require('tamagui');`, 1],
        ['a native leaf', NATIVE_LEAF, `import { View } from 'tamagui';`, 0],
        ['the mobile app', MOBILE, `import { View } from 'tamagui';`, 0],
        ['a package whose name only starts with tamagui', WEB_LEAF, `import x from 'tamagui-extras';`, 0],
    ] as const)('%s', (_shape, file, source, expected) => {
        expect(tamaguiImportFindings(source, file)).toHaveLength(expected);
    });

    it('finds none in the tree', () => {
        const findings = appSourceModules().flatMap((file) =>
            tamaguiImportFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file),
        );

        expect(findings).toEqual([]);
    });
});

describe('G1: the closed allow-list of Tamagui value imports', () => {
    it.each([
        ['a Popover, which no guard classifies', `import { Popover } from 'tamagui';`, 1],
        ['a Dialog, whose guard is overlayHostBoundary', `import { Dialog } from 'tamagui';`, 0],
        // The one animated overlay part (ADR-0080 §7): its window, motion and open state are held by overlayHostBoundary and tamaguiMotionProps.
        ['a Sheet, whose guards are overlayHostBoundary and tamaguiMotionProps', `import { Sheet } from 'tamagui';`, 0],
        ['a Sheet through a namespace member', `import * as T from 'tamagui';\nconst d = <T.Sheet />;`, 0],
        ['a Paragraph from @tamagui/text', `import { Paragraph } from '@tamagui/text';`, 1],
        ['a Button, an Input and an Image', `import { Button, Input, Image } from 'tamagui';`, 3],
        ['a Popover through a namespace member', `import * as T from 'tamagui';\nconst d = <T.Popover />;`, 1],
        ['a re-export of an unclassified element', `export { Popover } from 'tamagui';`, 1],
        ['a type-only import', `import type { GetProps } from 'tamagui';`, 0],
        ['a type-only name inside a value import', `import { View, type GetProps } from 'tamagui';`, 0],
        [
            'the classified elements and styled',
            `import { styled, View, Stack, XStack, YStack, ZStack, ScrollView, Text } from 'tamagui';`,
            0,
        ],
        [
            'the provider and the config builders',
            `import { TamaguiProvider, createTamagui, createTokens, createFont } from 'tamagui';`,
            0,
        ],
        // H-1: a styled context carries a value to variants and resolvers the guards already read; its Provider draws no box.
        ['the animation driver builder', `import { createAnimations } from '@tamagui/animations-react-native';`, 0],
        ['a styled context', `import { createStyledContext } from 'tamagui';`, 0],
        ['a renamed allowed name', `import { View as Box } from 'tamagui';`, 0],
        // H3: a sub-theme is selected by `<Theme name>`, which draws no box; the props it may carry are G1c's.
        ['Theme, which draws nothing', `import { Theme } from 'tamagui';`, 0],
        ['a renamed unclassified name', `import { Popover as Drawer } from 'tamagui';`, 1],
        ['a default import, whose members no guard can classify', `import T from 'tamagui';`, 1],
        ['an export of everything', `export * from 'tamagui';`, 1],
        ['a type-only re-export', `export type { GetProps } from 'tamagui';`, 0],
    ] as const)('%s', (_shape, source, expected) => {
        expect(tamaguiUnclassifiedImportFindings(source, NATIVE_LEAF)).toHaveLength(expected);
    });

    it('finds none in the tree', () => {
        const findings = appSourceModules().flatMap((file) =>
            tamaguiUnclassifiedImportFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file),
        );

        expect(findings).toEqual([]);
    });
});

describe('G2: tamaguiThemeHookFindings', () => {
    it.each([
        ['useTheme from tamagui', `import { useTheme } from 'tamagui';`, 1],
        ['a renamed one', `import { useTheme as useT } from 'tamagui';`, 1],
        ['useThemeName and getTokens', `import { useThemeName, getTokens } from '@tamagui/core';`, 2],
        ['through a namespace', `import * as T from 'tamagui';\nconst t = T.useTheme();`, 1],
        ['the design system’s own hook', `import { useTheme } from '@commise/ui/theme';`, 0],
        ['a type-only import', `import type { useTheme } from 'tamagui';`, 0],
    ] as const)('%s', (_shape, source, expected) => {
        expect(tamaguiThemeHookFindings(source, NATIVE_LEAF)).toHaveLength(expected);
    });

    it('finds none in the tree', () => {
        const findings = appSourceModules().flatMap((file) =>
            tamaguiThemeHookFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file),
        );

        expect(findings).toEqual([]);
    });
});

describe('G1c: tamaguiThemeElementFindings — <Theme> carries a tone name and nothing else', () => {
    const imported = `import { Theme } from 'tamagui';\n`;

    it.each([
        ['a name', `<Theme name="inverse"><X /></Theme>`, 0],
        ['a name from an expression', `<Theme name={tone}><X /></Theme>`, 0],
        ['the inverse prop, which flips light and dark', `<Theme name="paper" inverse><X /></Theme>`, 1],
        ['reset, which drops the parent chain', `<Theme reset><X /></Theme>`, 1],
        ['forceClassName', `<Theme name="paper" forceClassName><X /></Theme>`, 1],
        ['any other prop', `<Theme name="paper" debug><X /></Theme>`, 1],
        ['a spread, which no guard can read', `<Theme {...props}><X /></Theme>`, 1],
        ['a self-closing element with a stray prop', `<Theme name="paper" disable />`, 1],
        ['each stray prop on its own', `<Theme name="paper" inverse reset />`, 2],
    ] as const)('%s', (_shape, jsx, expected) => {
        expect(tamaguiThemeElementFindings(`${imported}const x = ${jsx};`, NATIVE_LEAF)).toHaveLength(expected);
    });

    it('follows a renamed import and a namespace member', () => {
        expect(
            tamaguiThemeElementFindings(
                `import { Theme as Tone } from 'tamagui';\nconst x = <Tone reset />;`,
                NATIVE_LEAF,
            ),
        ).toHaveLength(1);
        expect(
            tamaguiThemeElementFindings(`import * as T from 'tamagui';\nconst x = <T.Theme inverse />;`, NATIVE_LEAF),
        ).toHaveLength(1);
    });

    it('ignores a Theme that does not come from Tamagui', () => {
        expect(
            tamaguiThemeElementFindings(`import { Theme } from './Theme.js';\nconst x = <Theme reset />;`, NATIVE_LEAF),
        ).toHaveLength(0);
    });

    it('finds none in the tree', () => {
        const findings = appSourceModules().flatMap((file) =>
            tamaguiThemeElementFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file),
        );

        expect(findings).toEqual([]);
    });
});
