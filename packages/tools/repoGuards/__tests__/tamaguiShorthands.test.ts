/**
 * G7 (ADR-0080): no Tamagui shorthand, on an element or in `styled()`. Tamagui 3 adds 41 shorthands to every config
 * whatever the config says (`lh` for `lineHeight`, `col` for `color`, `o` for `opacity`, `pe` for `pointerEvents`,
 * `bblr` for a corner radius). Every Tamagui style guard reads the LONG names, so a shorthand would walk past G4's type
 * rule, the colour and radius rules, the flatten guard and the pointer-events guard. One spelling per style keeps every
 * guard honest. The names are Tamagui's own, read from a config `createTamagui` builds, so a shorthand a later version
 * adds is refused too.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { nativeSources } from './nativeSources.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledExports } from './tamaguiElements.js';
import { shorthandFindings, TAMAGUI_SHORTHANDS } from './tamaguiShorthands.js';

const none = (): ReadonlySet<string> => new Set();

const head = `import { styled, Text, View } from 'tamagui';\n`;

describe('shorthandFindings', () => {
    it('reads Tamagui’s own shorthand table, which holds the ones that would bypass the other guards', () => {
        for (const name of ['lh', 'fs', 'ff', 'fw', 'col', 'o', 'pe', 'bblr']) {
            expect(TAMAGUI_SHORTHANDS.has(name), name).toBe(true);
        }
    });

    it.each([
        ['a line-height shorthand on Text', `<Text lh={24} />`, 1],
        ['a colour and an opacity shorthand on View', `<View col="$ink" o={0.4} />`, 2],
        ['a pointer-events shorthand', `<View pe="none" />`, 1],
        ['a shorthand in styled()', `const B = styled(View, { bblr: '$md' });`, 1],
        ['a shorthand in a styled() variant', `const B = styled(View, { variants: { on: { true: { o: 0.4 } } } });`, 1],
        [
            'a cast-wrapped styled() binding used with a shorthand',
            `const R = styled(View, {}) as typeof View;\n<R o={1} />`,
            1,
        ],
        ['the long names', `<View opacity={0.4} pointerEvents="none" />`, 0],
        [
            'a variant named like a shorthand is not a style',
            `const B = styled(View, { variants: { o: { true: { opacity: 1 } } } });`,
            0,
        ],
        [
            'a React Native element is not this rule',
            `import { View as RNView } from 'react-native';\n<RNView o={1} />`,
            0,
        ],
    ] as const)('%s', (_shape, body, expected) => {
        expect(shorthandFindings(head + body, 'fixture.tsx', none)).toHaveLength(expected);
    });

    it('finds none in the tree', () => {
        const findings = nativeSources().flatMap((file) =>
            shorthandFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledExports),
        );

        expect(findings).toEqual([]);
    });
});
