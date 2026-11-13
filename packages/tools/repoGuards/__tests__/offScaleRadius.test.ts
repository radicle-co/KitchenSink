// @vitest-environment node
/**
 * Repo-wide guard: **every corner radius in `packages/apps` is a step of the design system's scale** (8, 12, 18, 24 px:
 * `sm`, `md`, `lg`, `xl`, and the pill, `full`). The role picks the step: notices, cards, menus, popovers and comboboxes
 * are `lg`; dialogs, sheets and full-screen modals are `xl`; pills are `full`.
 *
 * It grew out of `@commise/ui`'s own scan of `rounded-2xl` (16 px, which is on NONE of the steps). That scan read only
 * the design system and left the feature files out as "a follow-up"; there is no such exemption here, and no allow-list
 * for an app file. The scan reads the parsed syntax tree (`offScaleRadius.ts`), so a comment that names a forbidden
 * class is not a violation and a URL string cannot hide one.
 *
 * Mutation lens: write `rounded-2xl` in any app file, a `borderRadius: 16`, a `borderRadius: size / 2` or a `999`, and
 * the file and line are listed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    appSources,
    isOffScaleClass,
    offScaleRadiusIn,
    offScaleRadiusUnder,
    tamaguiRadiusFindings,
} from './offScaleRadius.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledExports } from './tamaguiElements.js';
import { radiusTokenKeys } from './tamaguiScaleKeys.js';

const scan = (text: string, file = 'Sample.tsx'): readonly string[] =>
    offScaleRadiusIn(file, text).map((hit) => hit.text);

describe('radius scale, every app', () => {
    it('reads the design system, the features and both apps (a vacuous pass would hide the rule)', () => {
        const files = appSources();

        expect(files).toContain('packages/apps/commise/ui/src/sheet/Sheet.tsx');
        expect(files).toContain('packages/apps/commise/features/recipes/src/versions/RecipeConflictView.tsx');
        expect(files).toContain('packages/apps/commise/features/recipes/src/card/RecipeCard.native.tsx');
        expect(files.some((file) => file.startsWith('packages/apps/commise/web/src/'))).toBe(true);
        expect(files.some((file) => file.startsWith('packages/apps/commise/mobile/src/'))).toBe(true);
    });

    it('draws only the scale steps in a Tailwind class or a native radius', () => {
        expect(offScaleRadiusUnder()).toEqual([]);
    });

    it('recognises the classes it forbids', () => {
        for (const token of [
            'rounded',
            'rounded-xs',
            'rounded-2xl',
            'sm:rounded-2xl',
            'rounded-t-3xl',
            'hover:rounded-4xl',
            'rounded-[10px]',
            'md:rounded-b-[calc(var(--radius-md)*2)]',
            'rounded-tl',
            'rounded-[calc(1px+2px)]',
        ]) {
            expect(isOffScaleClass(token), token).toBe(true);
        }

        for (const token of [
            'rounded-sm',
            'rounded-md',
            'rounded-lg',
            'rounded-xl',
            'rounded-full',
            'rounded-none',
            'rounded-t-xl',
            'sm:rounded-b-lg',
            'rounded-[calc(var(--spacing)*5.5)]',
            'rounded-s-full',
            'roundedness',
            'text-rounded',
        ]) {
            expect(isOffScaleClass(token), token).toBe(false);
        }
    });

    it('finds a forbidden class in a string, a template fragment and a JSX attribute', () => {
        expect(scan('const a = "p-4 rounded-2xl";')).toEqual(['rounded-2xl']);
        expect(scan('const a = `flex rounded-3xl ${x}`;')).toEqual(['rounded-3xl']);
        expect(scan('const a = <div className="rounded" />;')).toEqual(['rounded']);
    });

    it('does not read a class name that a substitution completes, or one in a comment', () => {
        expect(scan('const a = `rounded-${size}`;')).toEqual([]);
        expect(scan('// rounded-2xl\n/** rounded-3xl */\nconst a = "rounded-lg";')).toEqual([]);
    });

    it('finds a native radius that is not a token', () => {
        expect(scan('const s = { borderRadius: 16 };')).toEqual(['borderRadius: 16']);
        expect(scan('const s = { borderRadius: 999 };')).toEqual(['borderRadius: 999']);
        expect(scan('const s = { borderRadius: 32 / 2 };')).toEqual(['borderRadius: 32 / 2']);
        expect(scan('const s = { borderRadius: SIZE / 3 };')).toEqual(['borderRadius: SIZE / 3']);
        expect(scan('const s = { borderTopLeftRadius: 24 };')).toEqual(['borderTopLeftRadius: 24']);
        expect(scan('const s = { borderRadius };')).toEqual(['borderRadius']);
        expect(scan("const s = { borderRadius: '50%' };")).toEqual(["borderRadius: '50%'"]);
    });

    it('accepts a token, zero, and a choice between tokens', () => {
        expect(scan('const s = { borderRadius: nativeTokens.radius.md };')).toEqual([]);
        expect(scan('const s = { borderTopLeftRadius: radius.xl, borderRadius: 0 };')).toEqual([]);
        expect(scan('const s = { borderRadius: wide ? radius.lg : radius.full };')).toEqual([]);
        expect(scan('const s = { borderRadius: HEIGHT / 2 };')).toEqual([]);
        expect(scan('const s = { borderRadius: wide ? radius.lg : 8 };')).toEqual([
            'borderRadius: wide ? radius.lg : 8',
        ]);
    });

    // The glyph ruling: a fixed-size mark (the 18 px checkbox) owns a corner no step fits, as a named GLYPH_ constant,
    // and only a module whose JSDoc @pattern names it a Glyph may read one. There is no `xs` step.
    describe('a glyph corner', () => {
        const glyph = (body: string): string => `/**\n * @module x\n *\n * @pattern Glyph — a fixed mark\n */\n${body}`;
        const plain = (body: string): string => `/**\n * @module x\n *\n * @pattern Adapter over a thing\n */\n${body}`;
        const web = 'const a = <span style={{ borderRadius: GLYPH_CORNER }} />;';
        const native = 'const s = { box: { borderRadius: GLYPH_CORNER } };';

        it('is allowed in a module whose @pattern names it a glyph', () => {
            expect(scan(glyph(web))).toEqual([]);
            expect(scan(glyph(native))).toEqual([]);
        });

        it('fails in a module that is not a glyph, with the same value', () => {
            expect(scan(plain(web))).toEqual(['borderRadius: GLYPH_CORNER']);
            expect(scan(plain(native))).toEqual(['borderRadius: GLYPH_CORNER']);
            expect(scan(web)).toEqual(['borderRadius: GLYPH_CORNER']);
        });

        it('does not let a glyph module draw a bare number or a class off the scale', () => {
            expect(scan(glyph('const s = { borderRadius: 4 };'))).toEqual(['borderRadius: 4']);
            expect(scan(glyph('const a = "rounded-[4px]";'))).toEqual(['rounded-[4px]']);
            expect(scan(glyph('const s = { borderRadius: CORNER };'))).toEqual(['borderRadius: CORNER']);
        });

        // A glyph that grows with its text keeps its corner in proportion: the one admitted shape is a named ratio times
        // the side, `side * GLYPH_CORNER_PER_SIDE`. Anything that adds arithmetic around it is layout, and is refused.
        describe('a glyph corner that scales with its side', () => {
            it.each([
                ['the side times the named ratio', 'side * GLYPH_CORNER_PER_SIDE'],
                ['the named ratio times the side', 'GLYPH_CORNER_PER_SIDE * side'],
            ])('admits %s in a glyph module', (_shape, value) => {
                expect(scan(glyph(`const s = { borderRadius: ${value} };`))).toEqual([]);
            });

            it.each([
                ['a quotient of the side', 'side / 3'],
                ['a bare-number ratio', 'side * 0.22'],
                ['a longer chain', 'side * GLYPH_X * 2'],
                ['the ratio worked out inline', '(side * GLYPH_X) / CHECK_BOX_MIN_SIDE'],
                ['a ratio that is not a glyph constant', 'side * CORNER_RATIO'],
                ['an offset on the admitted shape', 'side * GLYPH_CORNER_PER_SIDE + 1'],
                // A fractional radius renders on both platforms, so there is no reason to round it.
                ['a wrapped form (rounding is not needed)', 'Math.round(side * GLYPH_CORNER_PER_SIDE)'],
                ['two glyph constants', 'GLYPH_A * GLYPH_B'],
            ])('refuses %s in a glyph module', (_shape, value) => {
                expect(scan(glyph(`const s = { borderRadius: ${value} };`))).toEqual([`borderRadius: ${value}`]);
            });

            it('refuses the admitted shape outside a glyph module', () => {
                expect(scan(plain('const s = { borderRadius: side * GLYPH_CORNER_PER_SIDE };'))).toEqual([
                    'borderRadius: side * GLYPH_CORNER_PER_SIDE',
                ]);
            });
        });

        it('does not take the word in a comment or a later tag for the pattern', () => {
            expect(scan(`// @pattern Glyph\n${web}`)).toEqual(['borderRadius: GLYPH_CORNER']);
            expect(scan(`/** @pattern Adapter */\n/** @pattern Glyph */\n${web}`)).toEqual([
                'borderRadius: GLYPH_CORNER',
            ]);
        });
    });
});

// Tamagui (ADR-0080): a radius is a `$` token whose name is a key of `tamaguiTokens.radius`, on an element or in a
// `styled(…)` object. A number is off the scale here too (`strict` radius in the config makes it a type error; this
// refuses the cast route), and the generic reader above leaves a `styled(…)` object to this rule, because `'$md'` is a
// string, not the `radius.md` reference it reads.
describe('Tamagui radius', () => {
    const keys = new Set(['sm', 'md', 'full', '0']);
    const head = `import { styled, View } from 'tamagui';\n`;
    const none = (): ReadonlySet<string> => new Set();

    it.each([
        ['a radius token', `<View borderRadius="$md" />`, 0],
        ['the zero token', `<View borderRadius="$0" />`, 0],
        ['a token that is not a radius step', `<View borderRadius="$2xl" />`, 1],
        ['a name with no $', `<View borderRadius="md" />`, 1],
        ['a number', `<View borderRadius={16} />`, 1],
        ['a pill written as a number', `<View borderRadius={999} />`, 1],
        ['a percentage', `<View borderRadius="50%" />`, 1],
        ['a state modifier over tokens', `<View borderRadius="$sm hover:$md" />`, 0],
        ['a state modifier over a number', `<View borderRadius="$sm hover:16" />`, 1],
        ['a choice between tokens', `<View borderRadius={wide ? '$md' : '$full'} />`, 0],
        ['a choice with a number', `<View borderRadius={wide ? '$md' : 8} />`, 1],
        ['half the height', `<View borderRadius={HEIGHT / 2} />`, 1],
        ['a cast token', `<View borderRadius={'$md' as RadiusTokens} />`, 1],
        ['a variable', `<View borderRadius={r} />`, 1],
        [
            'each corner',
            `<View borderTopLeftRadius={4} borderEndStartRadius="$sm" borderBottomRightRadius="$nope" />`,
            2,
        ],
        ['a prop that is not a radius', `<View borderWidth={4} />`, 0],
        ['a styled() token', `const P = styled(View, { borderRadius: '$md' });`, 0],
        ['a styled() number', `const P = styled(View, { borderRadius: 16 });`, 1],
        ['a styled() cast', `const P = styled(View, { borderRadius: '$md' as RadiusTokens });`, 1],
        [
            'a variant table cast `as const`, as Tamagui writes it',
            `const P = styled(View, { variants: { round: { true: { borderRadius: '$md' } } } as const });`,
            0,
        ],
        [
            'a styled() variant number',
            `const P = styled(View, { variants: { round: { true: { borderRadius: 999 } } } });`,
            1,
        ],
        [
            'a styled() variant token',
            `const P = styled(View, { variants: { round: { true: { borderRadius: '$full' } } } });`,
            0,
        ],
        ['a styled() corner number', `const P = styled(View, { borderTopLeftRadius: 24 });`, 1],
        ['a styled() config the walk cannot read', `const P = styled(View, shared);`, 1],
        [
            'a radius on a React Native element is not this rule',
            `import { View as RNV } from 'react-native';\n<RNV borderRadius={16} />`,
            0,
        ],
    ] as const)('%s', (_shape, body, expected) => {
        expect(tamaguiRadiusFindings(head + body, 'fixture.tsx', none, keys)).toHaveLength(expected);
    });

    describe('a glyph corner that scales with its side', () => {
        const glyphHead = `/**\n * @module x\n *\n * @pattern Glyph — a mark\n */\n${head}`;

        it.each([
            ['the side times the named ratio', 'side * GLYPH_CORNER_PER_SIDE'],
            ['the named ratio times the side', 'GLYPH_CORNER_PER_SIDE * side'],
        ])('admits %s on an element in a glyph module', (_shape, value) => {
            expect(
                tamaguiRadiusFindings(`${glyphHead}<View borderRadius={${value}} />`, 'fixture.tsx', none, keys),
            ).toEqual([]);
        });

        it.each([
            ['a quotient of the side', 'side / 3'],
            ['a bare-number ratio', 'side * 0.22'],
            ['a longer chain', 'side * GLYPH_X * 2'],
            ['the ratio worked out inline', '(side * GLYPH_X) / CHECK_BOX_MIN_SIDE'],
            ['a ratio that is not a glyph constant', 'side * CORNER_RATIO'],
            ['an offset on the admitted shape', 'side * GLYPH_CORNER_PER_SIDE + 1'],
            ['a wrapped form (rounding is not needed)', 'Math.round(side * GLYPH_CORNER_PER_SIDE)'],
            ['two glyph constants', 'GLYPH_A * GLYPH_B'],
        ])('refuses %s on an element in a glyph module', (_shape, value) => {
            expect(
                tamaguiRadiusFindings(`${glyphHead}<View borderRadius={${value}} />`, 'fixture.tsx', none, keys),
            ).toHaveLength(1);
        });

        it('refuses the admitted shape outside a glyph module', () => {
            expect(
                tamaguiRadiusFindings(
                    `${head}<View borderRadius={side * GLYPH_CORNER_PER_SIDE} />`,
                    'fixture.tsx',
                    none,
                    keys,
                ),
            ).toHaveLength(1);
        });
    });

    it('leaves a styled() radius token to this rule, so the generic reader does not call it off the scale', () => {
        expect(
            scan(`import { styled, View } from 'tamagui';\nconst P = styled(View, { borderRadius: '$md' });`),
        ).toEqual([]);
        expect(scan(`import { styled } from 'other';\nconst P = styled(View, { borderRadius: '$md' });`)).toEqual([
            "borderRadius: '$md'",
        ]);
    });

    it('takes the radius steps from the design system', () => {
        expect([...radiusTokenKeys].sort()).toEqual(['0', 'full', 'lg', 'md', 'sm', 'xl']);
    });

    it('finds no off-scale Tamagui radius in the apps', () => {
        const findings = appSources().flatMap((file) =>
            tamaguiRadiusFindings(
                readFileSync(path.join(repoRoot, file), 'utf8'),
                file,
                designSystemStyledExports,
                radiusTokenKeys,
            ),
        );

        expect(findings).toEqual([]);
    });
});
