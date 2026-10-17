/**
 * The native control over a photo (D12; `modernizeA.md` §5, "Hero back and ⋯ buttons"): a 44 pt disc that is regular
 * Liquid Glass on iOS 26, untinted because user photos can be any brightness, and a solid `photoChip` disc everywhere
 * else, in the theme the system is in. Its name is the caller's label, never the glyph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const glass = vi.hoisted(() => ({ liquid: false, api: false, props: [] as Record<string, unknown>[] }));

vi.mock('expo-glass-effect', async () => {
    const { View } = await import('react-native');

    return {
        isLiquidGlassAvailable: () => glass.liquid,
        isGlassEffectAPIAvailable: () => glass.api,
        GlassView: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
            glass.props.push(props);

            return <View testID="glass-view">{props.children}</View>;
        },
    };
});

const scheme = vi.hoisted(() => ({ value: 'light' as 'light' | 'dark' }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, useColorScheme: () => scheme.value };
});

import { PhotoControl } from '../PhotoControl.native.js';
import { role, roleDark } from '../../tokens/colors.js';

beforeEach(() => {
    glass.liquid = false;
    glass.api = false;
    glass.props = [];
    scheme.value = 'light';
});
afterEach(cleanup);

const disc = (): CSSStyleDeclaration => getComputedStyle(screen.getByRole('button', { name: 'More actions' }));

describe('PhotoControl (native)', () => {
    it('is a button named by its label that reports a press', () => {
        const onPress = vi.fn();
        render(<PhotoControl icon="ellipsis" label="More actions" onPress={onPress} />);

        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('is a 44 pt disc', () => {
        render(<PhotoControl icon="ellipsis" label="More actions" onPress={vi.fn()} />);

        expect(disc().width).toBe('44px');
        expect(disc().height).toBe('44px');
        expect(disc().borderTopLeftRadius).toBe('22px');
    });

    it('draws regular, untinted, interactive glass on iOS 26', () => {
        glass.liquid = true;
        glass.api = true;
        render(<PhotoControl icon="ellipsis" label="More actions" onPress={vi.fn()} />);

        expect(screen.getByTestId('glass-view')).toBeTruthy();
        expect(glass.props[0]).toMatchObject({ glassEffectStyle: 'regular', isInteractive: true });
        expect(glass.props[0]?.['tintColor']).toBeUndefined();
    });

    it('draws no glass when either availability check fails', () => {
        glass.liquid = true;
        render(<PhotoControl icon="ellipsis" label="More actions" onPress={vi.fn()} />);

        expect(screen.queryByTestId('glass-view')).toBeNull();
    });

    it('is a solid photoChip disc without glass, in each theme', () => {
        const { unmount } = render(<PhotoControl icon="ellipsis" label="More actions" onPress={vi.fn()} />);
        const light = disc().backgroundColor;
        unmount();
        scheme.value = 'dark';
        render(<PhotoControl icon="ellipsis" label="More actions" onPress={vi.fn()} />);

        expect(light).toBe(cssColor(role.photoChip));
        expect(disc().backgroundColor).toBe(cssColor(roleDark.photoChip));
    });
});

/** The computed form of a token colour, as the DOM reports it. */
function cssColor(value: string): string {
    const probe = document.createElement('div');
    probe.style.backgroundColor = value;

    return probe.style.backgroundColor;
}
