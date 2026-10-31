/**
 * G6 (ADR-0080): `PressScale` owns the one press responder. A Tamagui element that is pressable, by a press handler
 * or by a press style, attaches Tamagui's own press handling, and on native that wraps the element in an extra
 * responder `View` (`@tamagui/web` `eventHandling.native.ts`): a second press owner and a different native tree. Press
 * state reaches a Tamagui surface as a variant prop (`pressed`) that `PressScale` hands down.
 *
 * Tamagui 3.1.9 writes a press style as a `press:` modifier inside a value (`bg="$paper press:$paperPress"`), or as a
 * `press` key of the object form, and reads `active` and `pressed` as aliases. The alias table is Tamagui's own
 * (`canonicalClauseModifier` from `@tamagui/style-grammar`), so a spelling Tamagui adds is read here too.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { nativeSources } from './nativeSources.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledExports } from './tamaguiElements.js';
import { pressOwnershipFindings } from './tamaguiPressOwnership.js';

const none = (): ReadonlySet<string> => new Set();

const head = `import { styled, View } from 'tamagui';\n`;

describe('pressOwnershipFindings', () => {
    it.each([
        ['onPress on a Tamagui element', `<View onPress={go} />`, 1],
        ['each press handler', `<View onPressIn={a} onPressOut={b} onLongPress={c} />`, 3],
        ['a press: modifier', `<View backgroundColor="$paper press:$paperPress" />`, 1],
        ['an active: alias', `<View backgroundColor="$paper active:$paperPress" />`, 1],
        ['a group-press modifier', `<View backgroundColor="group-press:$paperPress" />`, 1],
        ['a press modifier in a template literal', '<View backgroundColor={`$paper press:$paperPress`} />', 1],
        ['the object form', `<View backgroundColor={{ base: '$paper', press: '$paperPress' }} />`, 1],
        ['a press style inside styled()', `const P = styled(View, { backgroundColor: 'press:$paperPress' });`, 1],
        [
            'a press style in a styled() variant',
            `const P = styled(View, { variants: { on: { true: { opacity: 'press:0.8' } } } });`,
            1,
        ],
        ['a pressed: alias', `<View backgroundColor="pressed:$paperPress" />`, 1],
        ['onPress on a namespace member', `import * as T from 'tamagui';\n<T.View onPress={go} />`, 1],
        ['a styled() config that is not an object literal', `const P = styled(View, config);`, 1],
        ['a function variant', `const P = styled(View, { variants: { size: (v) => ({ padding: v }) } });`, 1],
        ['a spread inside styled()', `const P = styled(View, { ...shared, padding: '$2' });`, 1],
        ['a hover modifier is not a press owner', `<View backgroundColor="hover:$paperPress" />`, 0],
        ['a token that merely contains the word', `<View backgroundColor="$paperPress" />`, 0],
        ['the pressed variant PressScale hands down', `<View pressed={state.pressed} />`, 0],
        [
            'onPress on a React Native element is not this rule',
            `import { Pressable } from 'react-native';\n<Pressable onPress={go} />`,
            0,
        ],
    ] as const)('%s', (_shape, body, expected) => {
        expect(pressOwnershipFindings(head + body, 'fixture.tsx', none)).toHaveLength(expected);
    });

    it('finds no press owner on any Tamagui element in the tree', () => {
        const findings = nativeSources().flatMap((file) =>
            pressOwnershipFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledExports),
        );

        expect(findings).toEqual([]);
    });
});
