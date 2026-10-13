/**
 * The native hero button (A-014; D12): the same disc as the web leaf — regular Liquid Glass on iOS 26, a solid
 * `photoChip` disc elsewhere — as a pressable that can take a screen-reader focus request (`ref`) and report an
 * open/closed state, because the ⋯ menu's trigger is one.
 */
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const glass = vi.hoisted(() => ({ liquid: false, api: false }));

vi.mock('expo-glass-effect', async () => {
    const { View } = await import('react-native');

    return {
        isLiquidGlassAvailable: () => glass.liquid,
        isGlassEffectAPIAvailable: () => glass.api,
        GlassView: (props: { children?: React.ReactNode }) => <View testID="glass-view">{props.children}</View>,
    };
});

import { HeroButton } from '../HeroButton.native.js';

beforeEach(() => {
    glass.liquid = false;
    glass.api = false;
});
afterEach(cleanup);

describe('HeroButton (native)', () => {
    it('is a button named by its label that reports a press', () => {
        const onPress = vi.fn();
        render(<HeroButton icon="chevronLeft" label="Back to My recipes" onPress={onPress} />);

        fireEvent.click(screen.getByRole('button', { name: 'Back to My recipes' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('is a 44 pt disc', () => {
        render(<HeroButton icon="ellipsis" label="More actions" onPress={vi.fn()} />);
        const disc = getComputedStyle(screen.getByRole('button', { name: 'More actions' }));

        expect(disc.width).toBe('44px');
        expect(disc.height).toBe('44px');
    });

    it('draws glass on iOS 26 and a solid disc otherwise', () => {
        const { unmount } = render(<HeroButton icon="ellipsis" label="More actions" onPress={vi.fn()} />);
        expect(screen.queryByTestId('glass-view')).toBeNull();
        unmount();
        glass.liquid = true;
        glass.api = true;
        render(<HeroButton icon="ellipsis" label="More actions" onPress={vi.fn()} />);

        expect(screen.getByTestId('glass-view')).toBeTruthy();
    });

    it('reports an expanded state only when it is given one', () => {
        const { rerender } = render(<HeroButton icon="ellipsis" label="More actions" onPress={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-expanded')).toBeNull();

        rerender(<HeroButton icon="ellipsis" label="More actions" onPress={vi.fn()} expanded={false} />);
        expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-expanded')).toBe('false');

        rerender(<HeroButton icon="ellipsis" label="More actions" onPress={vi.fn()} expanded />);
        expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-expanded')).toBe('true');
    });

    it('opens nothing and reports aria-disabled while disabled', () => {
        const onPress = vi.fn();
        render(<HeroButton icon="ellipsis" label="More actions" onPress={onPress} disabled />);

        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

        expect(onPress).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('hands the pressable to a ref, for a screen-reader focus request', () => {
        const ref = createRef<unknown>();
        render(<HeroButton ref={ref as never} icon="ellipsis" label="More actions" onPress={vi.fn()} />);

        expect(ref.current).not.toBeNull();
    });
});
