/**
 * The design system's native `Text` (ADR-0080, slice 1): a Tamagui text whose ONE type prop is `typeRole`. Each role
 * paints the registered face, the size and the leading that `nativeTokens.type` holds for it, with the leading in px
 * (Tamagui reads a bare number as a ratio). Every expected value is read from the tokens, so a scale change moves this
 * test with it.
 */
import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithTamagui, resolvedColour } from '../../testing/tamaguiTesting.native.js';
import { role, roleDark } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import type { TypeRole } from '../../tokens/typography.js';
import { DesignSystemTheme } from '../../tamagui/DesignSystemTheme.native.js';
import { Text } from '../Text.native.js';

const SIZED_ROLES = [
    'barTitle',
    'sectionTitle',
    'cardTitle',
    'body',
    'readingBody',
    'meta',
    'list',
    'label',
    'caption',
    'figureStat',
] as const satisfies readonly Exclude<TypeRole, 'largeTitle' | 'figureInline'>[];

afterEach(cleanup);

function styleOf(text: string): CSSStyleDeclaration {
    return getComputedStyle(screen.getByText(text));
}

describe('Text (native)', () => {
    it.each(SIZED_ROLES)('paints %s in its registered face, size and leading', (name) => {
        const spec = nativeTokens.type[name];

        renderWithTamagui(<Text typeRole={name}>sample</Text>, 'light');

        expect(styleOf('sample').fontFamily).toContain(spec.fontFamily);
        expect(styleOf('sample').fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(styleOf('sample').lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it('paints largeTitle at the size every container class shares', () => {
        const { narrow, regular, wide } = nativeTokens.type.largeTitle;

        // One style for all three classes until they differ; when they do, Text must read the container class.
        expect(narrow).toEqual(regular);
        expect(wide).toEqual(regular);

        renderWithTamagui(<Text typeRole="largeTitle">Title</Text>, 'light');

        expect(styleOf('Title').fontFamily).toContain(regular.fontFamily);
        expect(styleOf('Title').fontSize).toBe(`${String(regular.fontSize)}px`);
        expect(styleOf('Title').lineHeight).toBe(`${String(regular.lineHeight)}px`);
    });

    // jsdom drops Tamagui's `font-variant` rule as it parses it (the element gets the class, the sheet gets no rule), so
    // the figure style is asserted on the variant table; a device is the evidence it renders (ADR-0080 §6).
    it('sets both figure roles in tabular, lining digits, and figureInline takes the size of its line', () => {
        const typeRole = new Map(Object.entries(Text.staticConfig.variants?.['typeRole'] ?? {}));

        expect(typeRole.get('figureStat')).toMatchObject({ fontVariant: ['tabular-nums', 'lining-nums'] });
        expect(typeRole.get('figureInline')).toEqual({
            fontFamily: nativeTokens.type.figureInline.fontFamily,
            fontVariant: ['tabular-nums', 'lining-nums'],
        });

        renderWithTamagui(
            <Text typeRole="body">
                Serves <Text typeRole="figureInline">12</Text>
            </Text>,
            'light',
        );

        expect(styleOf('12').fontFamily).toContain(nativeTokens.type.figureInline.fontFamily);
    });

    // Designer ruling 2026-11-01 (nativeBoards/designAnswers.md): a figure in a line keeps its ROLE's face and only
    // changes its digits, so the rating number stays regular meta, like the web's `text-meta tabular-nums`.
    // `figureInline` keeps its semibold for a figure the copy stresses.
    it('`figures` sets tabular, lining digits and nothing else', () => {
        const figures = new Map(Object.entries(Text.staticConfig.variants?.['figures'] ?? {}));

        expect(figures.get('true')).toEqual({ fontVariant: ['tabular-nums', 'lining-nums'] });
    });

    it('`figures` keeps the role it is set on', () => {
        const spec = nativeTokens.type.meta;

        renderWithTamagui(
            <Text typeRole="meta" figures>
                4.5
            </Text>,
            'light',
        );

        expect(styleOf('4.5').fontFamily).toContain(spec.fontFamily);
        expect(styleOf('4.5').fontFamily).not.toContain(nativeTokens.type.figureInline.fontFamily);
        expect(styleOf('4.5').fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(styleOf('4.5').lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it('is body when no role is named', () => {
        renderWithTamagui(<Text>plain</Text>, 'light');

        expect(styleOf('plain').fontSize).toBe(`${String(nativeTokens.type.body.fontSize)}px`);
    });

    // Tamagui's own Text defaults to `$color`, a theme key the design system does not define, so a device logged
    // `[tamagui] unknown color "color"` and showed a warning toast over the screen.
    it.each([
        ['light', role],
        ['dark', roleDark],
    ] as const)('is ink when no colour is named, in the %s scheme', (scheme, colors) => {
        renderWithTamagui(<Text>plain</Text>, scheme);

        expect(resolvedColour(screen.getByText('plain'), 'color')).toBe(formatRgb(colors.ink));
    });

    it.each([
        ['light', role],
        ['dark', roleDark],
    ] as const)('takes its colour as a role token, in the %s scheme', (scheme, colors) => {
        renderWithTamagui(
            <Text typeRole="meta" color="$inkMuted">
                quiet
            </Text>,
            scheme,
        );

        expect(resolvedColour(screen.getByText('quiet'), 'color')).toBe(formatRgb(colors.inkMuted));
    });

    // Android adds the font's own padding above and below a line, even under a fixed leading, so text sat low in a badge
    // or a pill (Tamagui audit M7). A browser adds none, so jsdom cannot show it; a device can.
    it('turns off Android font padding for every role', () => {
        expect(Text.staticConfig.defaultProps?.includeFontPadding).toBe(false);
    });

    // H-1 (ADR-0080 §8, corrected): React Native 0.86 on Android caps a text's size but not a set line height
    // (`TextAttributeProps.kt:42`), so the design-system Text turns system scaling off and draws both from the system
    // scale itself (`scaledTypeMetrics`), up to each role's ceiling. REWRITTEN from "caps at 2× via
    // maxFontSizeMultiplier", whose premise was the false citation.
    it('turns system scaling off, so React Native cannot grow its leading past the cap', () => {
        expect(Text.staticConfig.defaultProps?.allowFontScaling).toBe(false);
        expect(Text.staticConfig.defaultProps?.maxFontSizeMultiplier).toBeUndefined();
    });

    it('draws body at 2× size and 2× leading above the cap', () => {
        renderWithTamagui(<Text typeRole="body">big</Text>, 'light', 3.1);

        expect(styleOf('big').fontSize).toBe('32px');
        expect(styleOf('big').lineHeight).toBe('48px');
    });

    it('draws a display role at its 1.5× ceiling', () => {
        const { fontSize, lineHeight } = nativeTokens.type.largeTitle.regular;

        renderWithTamagui(<Text typeRole="largeTitle">Title</Text>, 'light', 3.1);

        expect(styleOf('Title').fontSize).toBe(`${String(fontSize * 1.5)}px`);
        expect(styleOf('Title').lineHeight).toBe(`${String(lineHeight * 1.5)}px`);
    });

    // Designer ruling 2026-11-01 (ADR-0080 §8): navigation chrome caps its labels at 1.5×, and only chrome may say so.
    it('draws a chrome label at its chrome cap above the system scale', () => {
        const { fontSize, lineHeight } = nativeTokens.type.caption;

        renderWithTamagui(
            <Text typeRole="caption" chromeCap="1.5">
                Recipes
            </Text>,
            'light',
            3.1,
        );

        expect(styleOf('Recipes').fontSize).toBe(`${String(fontSize * 1.5)}px`);
        expect(styleOf('Recipes').lineHeight).toBe(`${String(lineHeight * 1.5)}px`);
    });

    it('lets an inline figure take the scaled size of its line', () => {
        renderWithTamagui(
            <Text typeRole="body">
                Serves <Text typeRole="figureInline">12</Text>
            </Text>,
            'light',
            1.5,
        );

        expect(styleOf('12').fontSize).toBe('24px');
    });

    it('follows a change of the system scale', () => {
        const { rerender } = renderWithTamagui(<Text typeRole="body">live</Text>, 'light', 1);

        expect(styleOf('live').fontSize).toBe('16px');

        rerender(
            <DesignSystemTheme scheme="light" textScale={1.5}>
                <Text typeRole="body">live</Text>
            </DesignSystemTheme>,
        );

        expect(styleOf('live').fontSize).toBe('24px');
    });

    // REWRITTEN (H-1): a role's size and leading now come from `scaledTypeMetrics` at the system scale, so the `typeRole`
    // table carries only the face and the figure style. A size or leading left in it would fight the scaled one.
    it.each(Object.entries(Text.staticConfig.variants?.['typeRole'] ?? {}))(
        '%s sets only its face and figures in the role table',
        (_role, style) => {
            expect(Object.keys(style as object).filter((key) => key !== 'fontFamily' && key !== 'fontVariant')).toEqual(
                [],
            );
        },
    );
});
