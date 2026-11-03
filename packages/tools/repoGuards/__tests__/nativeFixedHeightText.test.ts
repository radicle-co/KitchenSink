/**
 * No native frame that holds text has a fixed `height` — fixture rows for the detector in `nativeFixedHeightText.ts`.
 *
 * ⛔ WHY. Text grows with the font scale and with a longer translation; a fixed `height` does not, so the text is clipped.
 * The Recipes search pill had `height: 48` around its input and cut the text at a large font scale; a device found it. A
 * `minHeight` is fine. The tree is asserted at the end: every finding must be in `EXEMPTIONS`, each with its reason and the
 * line that proves it, and an entry that no longer matches a finding fails (a stale exemption hides a future defect).
 * `allowed` is a frame whose text cannot grow past it. `owed` is a real defect whose fix changes how a screen looks at a
 * large text size, so it waits for the designer; it is listed, not hidden. The rows `reads the real frames` pin that the
 * reader finds fixed-height frames in the tree, so the assertion cannot pass vacuously.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixedHeightFrameSites, fixedHeightTextFrames } from './nativeFixedHeightText.js';
import { nativeSources } from './nativeSources.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledKinds, type StyledKindsOf, type TamaguiKind } from './tamaguiElements.js';

/** No design-system package: the fixtures name every element they use. */
const noKinds: StyledKindsOf = () => new Map<string, TamaguiKind>();

const RN = `import { StyleSheet, View, Text, TextInput } from 'react-native';`;
const TG = `import { styled, View, XStack, YStack, Text } from 'tamagui';`;

/** [what the shape is, the module text, the number of findings it must produce]. */
const SHAPES: readonly (readonly [string, string, number])[] = [
    [
        'a fixed-height View around a Text (the defect)',
        `${RN} const A = () => <View style={{ height: 48 }}><Text>Hi</Text></View>;`,
        1,
    ],
    [
        'a fixed-height View around a TextInput (the search pill)',
        `${RN} const A = () => <View style={{ height: 48 }}><TextInput /></View>;`,
        1,
    ],
    [
        'a minHeight View around a Text',
        `${RN} const A = () => <View style={{ minHeight: 48 }}><Text>Hi</Text></View>;`,
        0,
    ],
    ['a maxHeight only', `${RN} const A = () => <View style={{ maxHeight: 48 }}><Text>Hi</Text></View>;`, 0],
    [
        'a lineHeight is not a frame height',
        `${RN} const A = () => <View style={{ lineHeight: 20 }}><Text>Hi</Text></View>;`,
        0,
    ],
    ['a fixed-height View with no text (a divider)', `${RN} const A = () => <View style={{ height: 1 }} />;`, 0],
    [
        'a percentage height fills the parent',
        `${RN} const A = () => <View style={{ height: '100%' }}><Text>Hi</Text></View>;`,
        0,
    ],
    ['height auto', `${RN} const A = () => <View style={{ height: 'auto' }}><Text>Hi</Text></View>;`, 0],
    [
        'the height in a StyleSheet entry of the same file',
        `${RN} const styles = StyleSheet.create({ pill: { height: 48 } }); const A = () => <View style={styles.pill}><Text>Hi</Text></View>;`,
        1,
    ],
    [
        'a StyleSheet entry with a minHeight',
        `${RN} const styles = StyleSheet.create({ pill: { minHeight: 48 } }); const A = () => <View style={styles.pill}><Text>Hi</Text></View>;`,
        0,
    ],
    [
        'the height in an array style, behind a condition',
        `${RN} const styles = StyleSheet.create({ pill: { height: 48 }, row: { flexDirection: 'row' } }); const A = ({ on }) => <View style={[styles.row, on && styles.pill]}><Text>Hi</Text></View>;`,
        1,
    ],
    [
        'a height in an object constant',
        `${RN} const PILL = { height: 40 }; const A = () => <View style={PILL}><Text>Hi</Text></View>;`,
        1,
    ],
    ['written text as the only child', `${RN} const A = () => <View style={{ height: 48 }}>Hello</View>;`, 1],
    [
        'an expression child that is a string',
        `${RN} const A = ({ label }) => <View style={{ height: 48 }}>{label}</View>;`,
        1,
    ],
    [
        'the text two levels down',
        `${RN} const A = () => <View style={{ height: 48 }}><View><Text>Hi</Text></View></View>;`,
        1,
    ],
    [
        'only an icon inside a fixed-height frame',
        `${RN} const A = () => <View style={{ height: 48 }}><SearchIcon /></View>;`,
        0,
    ],
    [
        'children it cannot see into are a finding, not a pass',
        `${RN} const A = ({ children }) => <View style={{ height: 48 }}>{children}</View>;`,
        1,
    ],
    [
        'an unknown component inside a fixed-height frame is a finding, not a pass',
        `${RN} const A = () => <View style={{ height: 48 }}><Pill /></View>;`,
        1,
    ],
    [
        'a style built by a call, around text, cannot be read',
        `${RN} const A = () => <View style={makeStyle()}><Text>Hi</Text></View>;`,
        1,
    ],
    ['a style built by a call, around nothing', `${RN} const A = () => <View style={makeStyle()} />;`, 0],
    ['Tamagui height prop around a Text', `${TG} const A = () => <YStack height={48}><Text>Hi</Text></YStack>;`, 1],
    ['Tamagui h prop around a Text', `${TG} const A = () => <XStack h={48}><Text>Hi</Text></XStack>;`, 1],
    ['Tamagui minHeight around a Text', `${TG} const A = () => <YStack minHeight={48}><Text>Hi</Text></YStack>;`, 0],
    [
        'Tamagui height from a token, around a Text',
        `${TG} const A = () => <YStack height="$12"><Text>Hi</Text></YStack>;`,
        1,
    ],
    [
        'a styled frame with a base height, used around a Text',
        `${TG} const Pill = styled(XStack, { height: 48 }); const A = () => <Pill><Text>Hi</Text></Pill>;`,
        1,
    ],
    [
        'a styled frame with a minHeight',
        `${TG} const Pill = styled(XStack, { minHeight: 48 }); const A = () => <Pill><Text>Hi</Text></Pill>;`,
        0,
    ],
    [
        'a styled frame whose variant sets a height',
        `${TG} const Pill = styled(XStack, { variants: { big: { true: { height: 64 } } } }); const A = () => <Pill big><Text>Hi</Text></Pill>;`,
        1,
    ],
    [
        'a Text itself with a fixed height is not a frame',
        `${RN} const A = () => <Text style={{ height: 20 }}>Hi</Text>;`,
        0,
    ],
    [
        'two frames, one fixed',
        `${RN} const A = () => (<><View style={{ height: 48 }}><Text>A</Text></View><View><Text>B</Text></View></>);`,
        1,
    ],
];

describe('fixedHeightTextFrames — fixture rows', () => {
    it.each(SHAPES)('%s', (_name, source, expected) => {
        expect(fixedHeightTextFrames(source, 'Fixture.native.tsx', noKinds)).toHaveLength(expected);
    });

    it('names the line', () => {
        expect(
            fixedHeightTextFrames(
                `${RN}\nconst A = () => (\n<View style={{ height: 48 }}><Text>Hi</Text></View>\n);`,
                'Fixture.native.tsx',
                noKinds,
            ),
        ).toEqual(['3: a fixed height around text — <View style={{ height: 48 }}>']);
    });
});

describe('fixedHeightFrameSites — the reader finds the real frames', () => {
    const REAL_FRAMES = [
        'packages/apps/commise/ui/src/avatar/AvatarDisc.native.tsx',
        'packages/apps/commise/ui/src/heroButton/HeroButton.native.tsx',
        'packages/apps/commise/ui/src/largeTitleHeader/LargeTitleHeader.native.tsx',
    ] as const;

    it.each(REAL_FRAMES)('reads a fixed-height frame in %s', (file) => {
        expect(
            fixedHeightFrameSites(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledKinds),
        ).toBeGreaterThan(0);
    });
});

/** Why a finding in the tree stands. `allowed`: its text cannot grow. `owed`: a defect waiting on a visual decision. */
interface Exemption {
    readonly file: string;
    /** The start of the frame as the finding prints it, after ` — `. */
    readonly frame: string;
    readonly kind: 'allowed' | 'owed';
    readonly reason: string;
    /** `owed` only: the change that fixes it. */
    readonly fix?: string;
}

const APPS = 'packages/apps/commise/';

const EXEMPTIONS: readonly Exemption[] = [
    {
        file: `${APPS}features/account/src/profile/ProfileHeader.native.tsx`,
        frame: '<View style={[ styles.disc,',
        kind: 'allowed',
        reason: 'The initials are the design-system Text, role figureStat (L72), capped at 2x; "MW" at the cap measures 69.9 pt wide and 48 pt tall in a 72 pt disc (L94-95).',
    },
    {
        file: `${APPS}features/recipes/src/card/RecipeCard.native.tsx`,
        frame: '<View style={[styles.oneLine, { height }]}>',
        kind: 'allowed',
        reason: 'The BADGE row (the list row status line) is exactly one badge line, sized from the OS font scale (badgeLineHeightOf), and hides what does not fit by design. The meta line is not this row: it wraps with no height (UI Designer ruling 2026-11-03).',
    },
    {
        file: `${APPS}features/recipes/src/card/RecipeCard.native.tsx`,
        frame: '<View style={[ styles.coverChip,',
        kind: 'allowed',
        reason: "The status chip is exactly one line (height = metaLineHeightOf(fontScale) + its padding, CoverChip) and clips what wraps by design, so its glyph drops and its word stays (designer ruling 2026-11-03); the height follows the same OS font scale as the text, as the card's other one-line rows do.",
    },
    {
        file: `${APPS}features/recipes/src/card/RecipeCard.native.tsx`,
        frame: '<View style={thumbnail ? styles.thumbnail : styles.cover}>',
        kind: 'allowed',
        reason: 'The 80 pt thumbnail holds the RecipeCover monogram, sized to the box (RecipeCover.native.tsx L59-65), and the PRO badge, which keeps its size at every scale (pictorial, designer M-1).',
    },
    {
        file: `${APPS}features/recipes/src/collections/CollectionPickerRow.native.tsx`,
        frame: '<View style={styles.thumb}>',
        kind: 'allowed',
        reason: 'The 48 pt thumb holds the RecipeCover monogram, sized to the box (RecipeCover.native.tsx L59-65); the cuisine caption shows only from 96 pt tall (L73).',
    },
    {
        file: `${APPS}features/recipes/src/detail/heroBand.native.tsx`,
        frame: '<Box',
        kind: 'allowed',
        reason: 'The 96 pt band holds only the gradient (Wash, L24 and L32) and is aria-hidden (L31): it has no text, no disc and no letter (header comment, designer 2026-11-02). The reader counts the child Wash component as possible text.',
    },
    {
        file: `${APPS}ui/src/button/Button.native.tsx`,
        frame: '<View style={[ styles.base,',
        kind: 'allowed',
        reason: 'No fixed height: the geometry is a minHeight (L107). The reader cannot read the paint call, so it reports it.',
    },
    {
        file: `${APPS}ui/src/chip/Chip.native.tsx`,
        frame: '<View style={chipPill(theme, props.selected,',
        kind: 'allowed',
        reason: 'No fixed height: chipPill sets a minHeight (chipStyle.ts L53). The reader cannot read the call.',
    },
    {
        file: `${APPS}ui/src/chip/Chip.native.tsx`,
        frame: '<View style={chipPill(theme, false,',
        kind: 'allowed',
        reason: 'No fixed height: chipPill sets a minHeight (chipStyle.ts L53). The reader cannot read the call.',
    },
    {
        file: `${APPS}ui/src/chip/ChipRow.native.tsx`,
        frame: '<View style={chipPill(theme, chosen,',
        kind: 'allowed',
        reason: 'No fixed height: chipPill sets a minHeight (chipStyle.ts L53). The reader cannot read the call.',
    },
    {
        file: `${APPS}ui/src/createFab/FabFace.native.tsx`,
        frame: '<View style={[styles.face, shape,',
        kind: 'allowed',
        reason: 'The pill height follows the label up to the 1.5x chrome cap (L33, fabHeightAt) and the label is capped at 1.5x (L40, chromeCap); the collapsed 56 pt disc holds one icon.',
    },
    {
        file: `${APPS}ui/src/heroButton/HeroButton.native.tsx`,
        frame: '<View style={styles.disc}>',
        kind: 'allowed',
        reason: 'The 44 pt disc holds a single icon glyph (L34); there is no text.',
    },
    {
        file: `${APPS}ui/src/heroButton/HeroButton.native.tsx`,
        frame: '<View style={[styles.disc, styles.center,',
        kind: 'allowed',
        reason: 'The 44 pt disc holds a single icon glyph (L34); there is no text.',
    },
    {
        file: `${APPS}ui/src/largeTitleHeader/LargeTitleHeader.native.tsx`,
        frame: '<View style={[styles.action, { height: rowHeight }]}>',
        kind: 'allowed',
        reason: "The slot holds the caller's avatar disc, a control with no text of its own (L52); the reader counts `{action.avatar}` as text.",
    },
    {
        file: `${APPS}ui/src/largeTitleHeader/LargeTitleHeader.native.tsx`,
        frame: '<View style={[styles.action, styles.controls, { height: rowHeight }]}>',
        kind: 'allowed',
        reason: "The slot holds the caller's icon button and menu (L56-57), controls with no text of their own.",
    },
    {
        file: `${APPS}ui/src/sectionIndex/SectionIndex.native.tsx`,
        frame: '<View style={styles.progress}>',
        kind: 'allowed',
        reason: 'The 4 pt bar (L365) holds only segment Views (L255-262); the reader counts the `items.map` child as text.',
    },
    {
        file: `${APPS}ui/src/sheet/BottomSheetPanel.native.tsx`,
        frame: '<Animated.View style={[ styles.sheet,',
        kind: 'allowed',
        reason: "Its only height is `'100%'` (L199) or the content's own; the reader cannot read the width call.",
    },
    {
        file: `${APPS}features/recipes/src/discovery/DiscoveryFooter.native.tsx`,
        frame: '<View style={[styles.avatar,',
        kind: 'allowed',
        reason: 'The initial does not scale: it is 40% of the 20 pt disc, 8 pt, at every size (designer ruling c10ecadbf, 2026-11-03; DesignText fixedPx={initialsPxOf(FOOTER_AVATAR_PT)}), and the name beside it carries the meaning.',
    },
    {
        file: `${APPS}ui/src/avatar/AvatarDisc.native.tsx`,
        frame: '<Disc>',
        kind: 'allowed',
        reason: 'The initials do not scale: they are 40% of the disc (12 pt in 32, 14 pt in 36), so two letters fit at every size (designer ruling c10ecadbf, 2026-11-03; Text fixedPx={initialsPxOf(…)}); proven on real font metrics by discGeometry.fit.test.ts.',
    },
    {
        file: `${APPS}ui/src/recipeCover/RecipeCover.native.tsx`,
        frame: '<Cover>',
        kind: 'allowed',
        reason: 'Its text is the monogram letter, fixed at 40% of the cover (designer ruling c10ecadbf, 2026-11-03; Text fixedPx), and a cuisine caption that shows only from 96 pt tall and is clipped at the cover edge (overflow hidden, as before the Tamagui move). The `band` aspect (height 96) is the detail hero and takes no footer; a footer goes on the 4:3 and 1:1 aspects, whose height comes from the width.',
    },
];

describe('the tree — a fixed height around text is allowed only where the text cannot grow past it', () => {
    const findings = nativeSources().flatMap((file) =>
        fixedHeightTextFrames(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledKinds).map(
            (finding) => ({ file, finding }),
        ),
    );
    const matches = (entry: Exemption, found: { file: string; finding: string }): boolean =>
        entry.file === found.file && found.finding.split(' — ')[1]?.startsWith(entry.frame) === true;

    it('every finding has exactly one exemption', () => {
        const unexplained = findings.filter(({ file, finding }) => {
            return EXEMPTIONS.filter((entry) => matches(entry, { file, finding })).length !== 1;
        });

        expect(unexplained.map(({ file, finding }) => `${file}:${finding}`)).toEqual([]);
    });

    it('every exemption still matches a finding (a stale entry would hide a future defect)', () => {
        const stale = EXEMPTIONS.filter((entry) => !findings.some((found) => matches(entry, found)));

        expect(stale.map((entry) => `${entry.file} ${entry.frame}`)).toEqual([]);
    });

    it('every exemption carries a reason, and every owed one the fix', () => {
        for (const entry of EXEMPTIONS) {
            expect(entry.reason.length).toBeGreaterThan(30);

            if (entry.kind === 'owed') {
                expect(entry.fix?.length ?? 0).toBeGreaterThan(20);
            }
        }
    });
});
