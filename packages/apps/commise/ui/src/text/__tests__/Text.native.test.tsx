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
import { FONT_SCALE_CAP } from '../fontScaleCap.js';
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

    // Owner ruling 2026-10-31 (ADR-0080 §8): text grows with the system's text size up to 2×, WCAG 1.4.4's 200 %.
    it('caps the system text size at 2× for every role', () => {
        expect(FONT_SCALE_CAP).toBe(2);
        expect(Text.staticConfig.defaultProps?.maxFontSizeMultiplier).toBe(2);
    });

    // React Native scales a set line height by the same capped multiplier as the size (ADR-0080 §8 cites its source),
    // so a leading that holds its text at 1× holds it at the 2× cap; that claim rests on the citation, and this row
    // holds the 1× half. A bare number would be a RATIO in Tamagui, so a role whose leading stopped being px would
    // render at that many times its size.
    it.each(Object.entries(Text.staticConfig.variants?.['typeRole'] ?? {}))(
        '%s keeps a px leading that holds its text',
        (_role, style) => {
            const { fontSize, lineHeight } = style as { readonly fontSize?: number; readonly lineHeight?: string };

            if (fontSize === undefined) {
                // figureInline takes the size and leading of its line.
                expect(lineHeight).toBeUndefined();

                return;
            }

            expect(lineHeight).toMatch(/^\d+px$/u);
            expect(Number.parseFloat(lineHeight ?? '')).toBeGreaterThanOrEqual(fontSize);
        },
    );
});
