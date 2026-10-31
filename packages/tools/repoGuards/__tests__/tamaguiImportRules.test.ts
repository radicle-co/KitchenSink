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
        ['a Sheet, which no guard classifies', `import { Sheet } from 'tamagui';`, 1],
        ['a Paragraph from @tamagui/text', `import { Paragraph } from '@tamagui/text';`, 1],
        ['a Button, an Input and an Image', `import { Button, Input, Image } from 'tamagui';`, 3],
        ['a Dialog through a namespace member', `import * as T from 'tamagui';\nconst d = <T.Dialog />;`, 1],
        ['a re-export of an unclassified element', `export { Dialog } from 'tamagui';`, 1],
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
        ['a renamed allowed name', `import { View as Box } from 'tamagui';`, 0],
        ['a renamed unclassified name', `import { Sheet as Drawer } from 'tamagui';`, 1],
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
