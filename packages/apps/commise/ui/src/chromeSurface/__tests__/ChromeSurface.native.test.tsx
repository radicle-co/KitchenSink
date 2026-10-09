/**
 * The native bar material (D12, D14): real glass on iOS 26 (both availability checks), a solid `paperRaised` surface
 * with a hairline everywhere else, in the theme the system is in. Hidden glass is `glassEffectStyle: 'none'`, never an
 * opacity, which would stop `GlassView` rendering at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const glass = vi.hoisted(() => ({ liquid: false, api: false, props: [] as Record<string, unknown>[] }));

vi.mock('expo-glass-effect', async () => {
    const { View } = await import('react-native');

    return {
        isLiquidGlassAvailable: () => glass.liquid,
        isGlassEffectAPIAvailable: () => glass.api,
        GlassView: (props: Record<string, unknown>) => {
            glass.props.push(props);

            return <View testID="glass-view" />;
        },
    };
});

const scheme = vi.hoisted(() => ({ value: 'light' as 'light' | 'dark' }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, useColorScheme: () => scheme.value };
});

import { ChromeSurface } from '../ChromeSurface.native.js';
import { roleDark, role } from '../../tokens/colors.js';

beforeEach(() => {
    glass.liquid = false;
    glass.api = false;
    glass.props = [];
    scheme.value = 'light';
});
afterEach(cleanup);

const firstStyle = (container: HTMLElement): CSSStyleDeclaration => {
    const node = container.firstElementChild;

    if (!(node instanceof HTMLElement)) {
        throw new Error('no surface');
    }

    return getComputedStyle(node);
};

describe('ChromeSurface (native)', () => {
    it('draws regular Liquid Glass that follows the system scheme on iOS 26', () => {
        glass.liquid = true;
        glass.api = true;
        const { getByTestId } = render(<ChromeSurface edge="top" />);

        expect(getByTestId('glass-view')).toBeTruthy();
        expect(glass.props[0]).toMatchObject({
            glassEffectStyle: { style: 'regular', animate: true },
            colorScheme: 'auto',
            pointerEvents: 'none',
        });
    });

    it('falls back to the solid surface when an iOS 26 beta lacks the glass API', () => {
        glass.liquid = true;
        glass.api = false;
        const { queryByTestId } = render(<ChromeSurface edge="top" />);

        expect(queryByTestId('glass-view')).toBeNull();
    });

    it('hides glass by its effect style, never by opacity', () => {
        glass.liquid = true;
        glass.api = true;
        render(<ChromeSurface edge="bottom" visible={false} />);

        expect(glass.props[0]?.['glassEffectStyle']).toEqual({ style: 'none', animate: true });
        expect(JSON.stringify(glass.props[0]?.['style'] ?? {})).not.toContain('opacity');
    });

    it('is solid paperRaised with a top hairline off iOS 26, in the light theme', () => {
        const style = firstStyle(render(<ChromeSurface edge="top" />).container);

        expect(style.backgroundColor).toBe(hexToRgb(role.paperRaised));
        expect(style.borderTopWidth).not.toBe('0px');
        expect(style.borderBottomWidth).toBe('0px');
    });

    it('takes the dark theme’s paperRaised when the system is dark', () => {
        scheme.value = 'dark';
        const style = firstStyle(render(<ChromeSurface edge="bottom" />).container);

        expect(style.backgroundColor).toBe(hexToRgb(roleDark.paperRaised));
        expect(style.borderBottomWidth).not.toBe('0px');
    });

    it('paints nothing while hidden', () => {
        const style = firstStyle(render(<ChromeSurface edge="top" visible={false} />).container);

        expect(style.backgroundColor === '' || style.backgroundColor === 'rgba(0, 0, 0, 0)').toBe(true);
    });
});

/** `#RRGGBB` as the `rgb(r, g, b)` jsdom reports. */
function hexToRgb(hex: string): string {
    const value = Number.parseInt(hex.slice(1), 16);

    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}
