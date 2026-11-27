/**
 * The icon-only control detector, proven shape by shape. A control whose only content is a glyph is built by hand
 * at each site (a 44 target, a focus ring, a press fill, a dim) and drifts. `IconButton` owns that look, so
 * the controls that are not `IconButton` are counted down. Each row is a shape, its source and what the detector
 * counts. The rows that count nothing matter as much: a detector that counts a labelled button or a dot link would
 * send the ratchet after the wrong code.
 */
import { describe, expect, it } from 'vitest';

import { iconOnlyControls } from './iconOnlyControls.js';

const FEATURE = 'packages/apps/commise/features/recipes/src/thing/Thing.tsx';

const FEATURE_NATIVE = 'packages/apps/commise/features/recipes/src/thing/Thing.native.tsx';

const UI = 'packages/apps/commise/ui/src/thing/Thing.tsx';

const ICON = `import { Icon } from '@commise/ui/icon';\n`;

const lines = (...parts: readonly string[]): string => parts.join('\n');

const RN = (names: string): string => `import { ${names} } from 'react-native';\n`;

describe('iconOnlyControls', () => {
    it.each([
        [
            'a web button holding an icon',
            `${ICON}const A = () => <button aria-label="x"><Icon name="x" /></button>;`,
            FEATURE,
        ],
        ['a link holding an icon', `${ICON}const A = () => <a href="/x"><Icon name="x" /></a>;`, FEATURE],
        [
            'a Pressable from react-native',
            `${ICON}${RN('Pressable')}const A = () => <Pressable><Icon name="x" /></Pressable>;`,
            FEATURE_NATIVE,
        ],
        [
            'a renamed Pressable',
            `${ICON}${RN('Pressable as P')}const A = () => <P><Icon name="x" /></P>;`,
            FEATURE_NATIVE,
        ],
        [
            'a Pressable reached through a namespace',
            lines(
                `${ICON}import * as RN from 'react-native';`,
                `const A = () => <RN.Pressable><Icon name="x" /></RN.Pressable>;`,
            ),
            FEATURE_NATIVE,
        ],
        [
            'a Touchable from react-native',
            lines(
                `${ICON}${RN('TouchableOpacity')}`,
                `const A = () => <TouchableOpacity><Icon name="x" /></TouchableOpacity>;`,
            ),
            FEATURE_NATIVE,
        ],
        [
            'a Close member holding an icon',
            `${ICON}const A = () => <Dialog.Close><Icon name="x" /></Dialog.Close>;`,
            FEATURE,
        ],
        [
            'a Trigger member holding an icon',
            `${ICON}const A = () => <DropdownMenu.Trigger><Icon name="x" /></DropdownMenu.Trigger>;`,
            FEATURE,
        ],
        ['a Close member holding a symbol', `const A = () => <Dialog.Close>×</Dialog.Close>;`, FEATURE],
        [
            'a Pressable holding a wrapped icon',
            `${ICON}${RN('Pressable, View')}const A = () => <Pressable><View><Icon name="x" /></View></Pressable>;`,
            FEATURE_NATIVE,
        ],
        [
            'a press handler on a wrapper of wrappers, copied from the primitive',
            lines(
                ICON,
                `const A = () => <PressScale onPress={go}>`,
                '<Frame><Circle><Icon name="x" /></Circle></Frame></PressScale>;',
            ),
            FEATURE_NATIVE,
        ],
        [
            'a glyph held in a const',
            `${ICON}const g = <Icon name="x" />;\nconst A = () => <button>{g}</button>;`,
            FEATURE,
        ],
        [
            'a conditional of glyphs',
            `${ICON}const A = () => <button>{busy ? <Icon name="a" /> : <Icon name="b" />}</button>;`,
            FEATURE,
        ],
        [
            'a render function returning a glyph',
            `${ICON}${RN('Pressable')}const A = () => <Pressable>{({ pressed }) => <Icon name="x" />}</Pressable>;`,
            FEATURE_NATIVE,
        ],
        [
            'a block-bodied render function returning a glyph',
            lines(
                `${ICON}${RN('Pressable')}`,
                `const A = () => <Pressable>{() => { return <Icon name="x" />; }}</Pressable>;`,
            ),
            FEATURE_NATIVE,
        ],
        [
            'a renamed Icon',
            lines(
                `import { Icon as Glyph } from '@commise/ui/icon';`,
                `const A = () => <button><Glyph name="x" /></button>;`,
            ),
            FEATURE,
        ],
        [
            'the design system’s relative Icon import',
            `import { Icon } from '../icon/Icon.native.js';\nconst A = () => <button><Icon name="x" /></button>;`,
            UI,
        ],
        [
            'the recipe identifier in feature code, where the exemption does not apply',
            lines(
                `${ICON}import { ICON_BUTTON_CLASS } from '@commise/ui/icon-button';`,
                `const A = () => <button className={ICON_BUTTON_CLASS}><Icon name="x" /></button>;`,
            ),
            FEATURE,
        ],
        [
            'a class chosen between a recipe and a hand-built one inside the design system',
            lines(
                `${ICON}import { A_CLASS } from '../iconButton/IconButton.js';`,
                `const A = () => <button className={on ? A_CLASS : PLAIN_CLASS}><Icon name="x" /></button>;`,
            ),
            UI,
        ],
    ] as const)('counts %s', (_shape, source, fileName) => {
        expect(iconOnlyControls(source, fileName)).toHaveLength(1);
    });

    it.each([
        [
            'an IconButton',
            lines(
                `import { IconButton } from '@commise/ui/icon-button';`,
                `const A = () => <IconButton icon="x" accessibilityLabel="x" onPress={go} />;`,
            ),
            FEATURE,
        ],
        [
            'a HeroButton',
            lines(
                `import { HeroButton } from '@commise/ui/hero-button';`,
                `const A = () => <HeroButton icon="x" accessibilityLabel="x" onPress={go} />;`,
            ),
            FEATURE,
        ],
        [
            'a button with a label beside its icon',
            `${ICON}const A = () => <button><Icon name="x" />Save</button>;`,
            FEATURE,
        ],
        ['a button holding a label', `const A = () => <Button>{label}</Button>;`, FEATURE],
        [
            'an icon that is not interactive',
            `${ICON}${RN('View')}const A = () => <View><Icon name="x" /></View>;`,
            FEATURE_NATIVE,
        ],
        [
            'an Icon from a module that is not the design system’s',
            `import { Icon } from './Icon.js';\nconst A = () => <button><Icon name="x" /></button>;`,
            FEATURE,
        ],
        [
            'a Pressable that is not react-native’s',
            lines(
                `${ICON}import { Pressable } from 'elsewhere';`,
                `const A = () => <Pressable><Icon name="x" /></Pressable>;`,
            ),
            FEATURE_NATIVE,
        ],
        [
            'the recipe identifier inside the design system',
            lines(
                `${ICON}import { ICON_BUTTON_CLASS } from '../iconButton/IconButton.js';`,
                `const A = () => <button className={ICON_BUTTON_CLASS}><Icon name="x" /></button>;`,
            ),
            UI,
        ],
        [
            'a class chosen between two recipes inside the design system',
            lines(
                `${ICON}import { A_CLASS, B_CLASS } from '../iconButton/IconButton.js';`,
                `const A = () => <button className={on ? A_CLASS : B_CLASS}><Icon name="x" /></button>;`,
            ),
            UI,
        ],
        [
            'a comment and a string that spell a control',
            `// <button><Icon name="x" /></button>\nconst a = '<button><Icon name="x" /></button>';`,
            FEATURE,
        ],
        ['a dot link with no glyph', `const A = () => <a href="/x"><span aria-hidden /></a>;`, FEATURE],
        [
            'a conditional with a glyph in one branch only',
            `${ICON}const A = () => <button>{busy ? <Icon name="a" /> : label}</button>;`,
            FEATURE,
        ],
        ['a button of three symbols', `const A = () => <button>---</button>;`, FEATURE],
        ['a button of letters', `const A = () => <button>OK</button>;`, FEATURE],
        ['an empty button', `const A = () => <button />;`, FEATURE],
        [
            'a type-only Icon import',
            `import type { Icon } from '@commise/ui/icon';\nconst A = () => <button><Icon name="x" /></button>;`,
            FEATURE,
        ],
    ] as const)('does not count %s', (_shape, source, fileName) => {
        expect(iconOnlyControls(source, fileName)).toHaveLength(0);
    });

    it('follows three wrappers to the glyph and no further', () => {
        const wrapped = (inner: string): string => `${ICON}const A = () => <button>${inner}</button>;`;
        const icon = '<Icon name="x" />';

        expect(iconOnlyControls(wrapped(`<div><span><i>${icon}</i></span></div>`), FEATURE)).toHaveLength(1);
        expect(iconOnlyControls(wrapped(`<div><span><i><b>${icon}</b></i></span></div>`), FEATURE)).toHaveLength(0);
    });

    it('names the line and the text of each control', () => {
        const [found] = iconOnlyControls(
            `${ICON}\nconst A = () => (\n    <button><Icon name="x" /></button>\n);`,
            FEATURE,
        );

        expect(found).toMatchObject({ line: 4, text: expect.stringContaining('<button>') });
    });

    it('counts each control once, however its handler and tag both qualify it', () => {
        const source = lines(
            `${ICON}${RN('Pressable')}`,
            'const A = () => <Pressable onPress={go}><Icon name="x" /></Pressable>;',
        );

        expect(iconOnlyControls(source, FEATURE_NATIVE)).toHaveLength(1);
    });
});
