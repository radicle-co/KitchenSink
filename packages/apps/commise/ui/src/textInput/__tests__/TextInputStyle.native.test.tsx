/**
 * Every design-system text input draws its text through ONE style (`inputTextStyle`), applied by the primitive itself,
 * so no input can forget it: the capped body size, no line height on iOS (it sits the text low), and no second scaling by
 * the platform on top of the capped size. A multi-line input keeps its leading.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withPlatformOs } from '../../testing/platformOs.native.js';
import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { scaledTypeSize } from '../../text/scaledType.js';
import { TextInput } from '../TextInput.native.js';

afterEach(cleanup);

const field = (
    os: 'ios' | 'android',
    scale: number,
    multiline = false,
    style: object = { paddingVertical: 12 },
): HTMLElement => {
    withPlatformOs(os, () =>
        renderWithTamagui(<TextInput accessibilityLabel="Name" multiline={multiline} style={style} />, 'light', scale),
    );

    return screen.getByRole('textbox', { name: 'Name' });
};

describe('TextInput (native) — the input text style', () => {
    it('draws the capped body size with no line height on iOS', () => {
        const input = field('ios', 3.1);

        expect(resolvedStyle(input, 'fontSize')).toBe(`${scaledTypeSize('body', 3.1).fontSize}px`);
        expect(input.style.lineHeight).toBe('');
    });

    it('also draws the capped line height on Android', () => {
        expect(resolvedStyle(field('android', 3.1), 'lineHeight')).toBe(`${scaledTypeSize('body', 3.1).lineHeight}px`);
    });

    it('keeps the capped line height for a multi-line input on iOS', () => {
        expect(resolvedStyle(field('ios', 3.1, true), 'lineHeight')).toBe(
            `${scaledTypeSize('body', 3.1).lineHeight}px`,
        );
    });

    it('lets a caller restyle the box but not the text size', () => {
        withPlatformOs('ios', () =>
            renderWithTamagui(<TextInput accessibilityLabel="Name" style={{ minHeight: 48 }} />, 'light', 3.1),
        );

        expect(screen.getByRole('textbox', { name: 'Name' }).style.minHeight).toBe('48px');
    });

    it("lifts a single-line field's ink on iOS by moving padding from top to bottom, the height unchanged", () => {
        const input = field('ios', 1);
        const drop = scaledTypeSize('body', 1).fontSize * 0.11;

        expect(Number.parseFloat(input.style.paddingTop)).toBeCloseTo(12 - drop, 3);
        expect(Number.parseFloat(input.style.paddingBottom)).toBeCloseTo(12 + drop, 3);
    });

    it("takes the leading drop off a multi-line field's top padding on iOS", () => {
        const input = field('ios', 1, true, { paddingVertical: 16 });

        expect(input.style.paddingTop).toBe('8.5px');
        expect(input.style.paddingBottom).toBe('16px');
    });

    it('leaves the padding alone on Android', () => {
        const input = field('android', 1);

        expect(input.style.paddingTop).toBe('12px');
        expect(input.style.paddingBottom).toBe('12px');
    });

    it.each([
        { inputMode: 'numeric' },
        { inputMode: 'decimal' },
        { keyboardType: 'number-pad' },
        { keyboardType: 'decimal-pad' },
    ] as const)('leaves a numeric input (%o) its padding on iOS: digits sit level with the line', (props) => {
        withPlatformOs('ios', () =>
            renderWithTamagui(
                <TextInput accessibilityLabel="Name" style={{ paddingVertical: 12 }} {...props} />,
                'light',
                1,
            ),
        );
        const input = screen.getByRole('textbox', { name: 'Name' });

        expect(input.style.paddingTop).toBe('12px');
        expect(input.style.paddingBottom).toBe('12px');
    });
});
