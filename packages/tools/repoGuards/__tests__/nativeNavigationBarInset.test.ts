/**
 * A window drawn under the Android navigation bar reads the bottom inset — fixture rows for the detector in
 * `nativeNavigationBarInset.ts`.
 *
 * ⛔ WHY. A `Modal` with `navigationBarTranslucent` is edge to edge, so the navigation bar covers its foot and the
 * keyboard does not resize it. A sheet that adds no bottom inset puts its actions under the bar or behind the keyboard
 * (found on a device). The real tree is NOT asserted here yet: its findings go to the lead first (job `preDevice`).
 * The rows `reads the real windows` pin that the reader finds them, so a later tree assertion cannot pass vacuously.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { translucentWindowSites, windowsWithoutBottomInset } from './nativeNavigationBarInset.js';
import { repoRoot } from './serviceSources.js';

const SA = `import { useSafeAreaInsets } from 'react-native-safe-area-context';`;
const RN = `import { Modal } from 'react-native';`;

/** [what the shape is, the module text, the number of findings it must produce]. */
const SHAPES: readonly (readonly [string, string, number])[] = [
    [
        'a translucent modal that never reads the inset (the defect)',
        `${RN} const A = () => <Modal navigationBarTranslucent />;`,
        1,
    ],
    [
        'a translucent modal whose module reads insets.bottom',
        `${RN} ${SA} const A = () => { const insets = useSafeAreaInsets(); return <Modal navigationBarTranslucent><V style={{ paddingBottom: insets.bottom }} /></Modal>; };`,
        0,
    ],
    [
        'bottom taken out by destructuring',
        `${RN} ${SA} const A = () => { const { bottom } = useSafeAreaInsets(); return <Modal navigationBarTranslucent><V pb={bottom} /></Modal>; };`,
        0,
    ],
    [
        'bottom taken out and renamed',
        `${RN} ${SA} const A = () => { const { bottom: foot } = useSafeAreaInsets(); return <Modal navigationBarTranslucent><V pb={foot} /></Modal>; };`,
        0,
    ],
    [
        'the hook read inline',
        `${RN} ${SA} const A = () => <Modal navigationBarTranslucent><V pb={useSafeAreaInsets().bottom} /></Modal>;`,
        0,
    ],
    [
        'the hook called but only top and left read',
        `${RN} ${SA} const A = () => { const insets = useSafeAreaInsets(); return <Modal navigationBarTranslucent><V pt={insets.top} pl={insets.left} /></Modal>; };`,
        1,
    ],
    [
        'the hook called and nothing read',
        `${RN} ${SA} const A = () => { useSafeAreaInsets(); return <Modal navigationBarTranslucent />; };`,
        1,
    ],
    [
        'a bottom read from some other object is not the inset',
        `${RN} ${SA} const A = ({ box }) => { useSafeAreaInsets(); return <Modal navigationBarTranslucent><V pb={box.bottom} /></Modal>; };`,
        1,
    ],
    [
        'the inset read from another hook of the same name is not the safe-area one',
        `${RN} import { useSafeAreaInsets } from './mine'; const A = () => { const insets = useSafeAreaInsets(); return <Modal navigationBarTranslucent><V pb={insets.bottom} /></Modal>; };`,
        1,
    ],
    ['translucency switched on by `{true}`', `${RN} const A = () => <Modal navigationBarTranslucent={true} />;`, 1],
    ['translucency from a variable', `${RN} const A = ({ t }) => <Modal navigationBarTranslucent={t} />;`, 1],
    ['translucency off', `${RN} const A = () => <Modal navigationBarTranslucent={false} />;`, 0],
    ['no translucency', `${RN} const A = () => <Modal visible />;`, 0],
    ['the house overlay host, translucent, no inset', `const A = () => <OverlayHost navigationBarTranslucent />;`, 1],
    ['a spread on a Modal cannot be read', `${RN} const A = (props) => <Modal {...props} />;`, 1],
    ['a spread on an OverlayHost cannot be read', `const A = (props) => <OverlayHost {...props} />;`, 1],
    ['a spread on an ordinary element is not a window', `const A = (props) => <View {...props} />;`, 0],
    [
        'two windows in one module with no read are two findings',
        `${RN} const A = () => (<><Modal navigationBarTranslucent /><Modal navigationBarTranslucent /></>);`,
        2,
    ],
];

describe('windowsWithoutBottomInset — fixture rows', () => {
    it.each(SHAPES)('%s', (_name, source, expected) => {
        expect(windowsWithoutBottomInset(source, 'Fixture.native.tsx')).toHaveLength(expected);
    });

    it('names the line', () => {
        expect(
            windowsWithoutBottomInset(
                `${RN}\nconst A = () => (\n<Modal navigationBarTranslucent />\n);`,
                'Fixture.native.tsx',
            ),
        ).toEqual(['3: a window under the navigation bar, and the module never reads the bottom inset']);
    });
});

describe('translucentWindowSites — the reader finds the real windows', () => {
    const REAL_WINDOWS = [
        'packages/apps/commise/ui/src/sheet/Sheet.native.tsx',
        'packages/apps/commise/ui/src/dialogFrame/DialogFrame.native.tsx',
        'packages/apps/commise/features/recipes/src/detail/PhotoCarousel.native.tsx',
    ] as const;

    it.each(REAL_WINDOWS)('reads the window in %s', (file) => {
        expect(translucentWindowSites(readFileSync(path.join(repoRoot, file), 'utf8'), file)).toBeGreaterThan(0);
    });
});
