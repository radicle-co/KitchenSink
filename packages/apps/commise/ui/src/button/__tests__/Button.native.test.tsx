import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text } from 'react-native';
import type { ReactElement } from 'react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Button } from '../Button.native.js';
import { gradient, toNativeGradient } from '../../tokens/gradients.js';

/**
 * Button (native) — rendered via react-native-web under jsdom. Mirrors the web leaf's behavioural coverage
 * against the RN accessibility tree (role / label / text): the label owns the accessible name, the icon is
 * present but hidden from assistive tech, and press / disabled / busy behave. A marker `<Text>` stands in
 * for the caller's vector icon so we can assert it renders AND is excluded from the accessible name.
 */

const markerIcon: ReactElement = <Text>ICON_MARKER</Text>;

afterEach(cleanup);

describe('Button (native)', () => {
    it('renders an accessible button whose name is the label', () => {
        render(
            <Button icon={markerIcon} onPress={vi.fn()}>
                Save changes
            </Button>,
        );

        expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('renders the icon but keeps it out of the accessible name', () => {
        render(
            <Button icon={markerIcon} onPress={vi.fn()}>
                Add step
            </Button>,
        );

        // The icon marker is rendered…
        const marker = screen.getByText('ICON_MARKER');
        expect(marker).toBeTruthy();
        // …inside an accessibility-hidden wrapper, so it never contributes to the button name.
        expect(marker.closest('[aria-hidden="true"]')).not.toBeNull();
        // The accessible name is the label alone (no icon text).
        expect(screen.getByRole('button', { name: 'Add step' })).toBeTruthy();
    });

    it('fires onPress when pressed', () => {
        const onPress = vi.fn();
        render(
            <Button icon={markerIcon} onPress={onPress}>
                Add ingredient
            </Button>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }));
        expect(onPress).toHaveBeenCalledOnce();
    });

    it('does not fire onPress when disabled', () => {
        const onPress = vi.fn();
        render(
            <Button icon={markerIcon} onPress={onPress} disabled>
                Add step
            </Button>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
        expect(onPress).not.toHaveBeenCalled();
    });

    it('does not fire onPress when busy (in-flight guard)', () => {
        const onPress = vi.fn();
        render(
            <Button icon={markerIcon} onPress={onPress} busy>
                Create recipe
            </Button>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }));
        expect(onPress).not.toHaveBeenCalled();
    });

    it('renders a labelled button for every variant', () => {
        for (const variant of ['primary', 'secondary', 'destructive'] as const) {
            const { unmount } = render(
                <Button icon={markerIcon} variant={variant} onPress={vi.fn()}>
                    {`Variant ${variant}`}
                </Button>,
            );
            expect(screen.getByRole('button', { name: `Variant ${variant}` })).toBeTruthy();
            unmount();
        }
    });

    it('paints the primary tier with the brand gradient (converges with the web CTA)', () => {
        const { container } = render(
            <Button icon={markerIcon} variant="primary" onPress={vi.fn()}>
                Get started
            </Button>,
        );

        const node = container.querySelector('[data-commise-stub="linear-gradient"]');
        expect(node).not.toBeNull();
        expect(node?.getAttribute('data-colors')).toBe(toNativeGradient(gradient.brand).colors.join('|'));
    });

    it('does NOT paint a gradient on the flat secondary tier', () => {
        const { container } = render(
            <Button icon={markerIcon} variant="secondary" onPress={vi.fn()}>
                Cancel
            </Button>,
        );

        expect(container.querySelector('[data-commise-stub="linear-gradient"]')).toBeNull();
    });

    it('gives the pill a 44px minimum touch height', () => {
        render(
            <Button icon={markerIcon} onPress={vi.fn()}>
                Save changes
            </Button>,
        );

        // The comfortable-touch floor from nativeTokens/target size — asserted on the resolved computed
        // style (react-native-web compiles StyleSheet metrics to atomic CSS classes, not inline styles).
        const button = screen.getByRole('button', { name: 'Save changes' });
        const surface = withMinHeight(button, '44px');
        expect(surface).not.toBeNull();
    });

    it('shows a real spinner and hides the icon when busy (no layout shift), still labelled', () => {
        const { rerender } = render(
            <Button icon={markerIcon} onPress={vi.fn()}>
                Create recipe
            </Button>,
        );
        // Idle: caller's icon shown, no progress indicator. (The spinner lives in the decorative,
        // aria-hidden icon slot — busy is announced via accessibilityState.busy — so query with hidden.)
        expect(screen.getByText('ICON_MARKER')).toBeTruthy();
        expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull();

        rerender(
            <Button icon={markerIcon} onPress={vi.fn()} busy>
                Create recipe
            </Button>,
        );
        // Busy: the ActivityIndicator takes the icon's slot (icon gone → no reflow), label unchanged.
        expect(screen.getByRole('progressbar', { hidden: true })).toBeTruthy();
        expect(screen.queryByText('ICON_MARKER')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create recipe' })).toBeTruthy();
    });

    it('adopts PressScale so the pill carries a press-scale transform (resting = neutral)', () => {
        render(
            <Button icon={markerIcon} onPress={vi.fn()}>
                Save changes
            </Button>,
        );

        // The accessible button IS the PressScale Pressable — its transform pipeline is wired and neutral
        // at rest (the pressed/reduce-motion outputs are proven in pressedScale.test.ts).
        expect(screen.getByRole('button', { name: 'Save changes' }).style.transform).toBe('scale(1)');
    });
});

/**
 * Find the descendant of `root` whose RESOLVED (react-native-web class-compiled) style has the given
 * `min-height`. RNW emits atomic CSS classes rather than inline styles, so `getComputedStyle` is the
 * honest way to read a StyleSheet metric back out of the DOM.
 */
function withMinHeight(root: HTMLElement, minHeight: string): HTMLElement | null {
    const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    return candidates.find((el) => getComputedStyle(el).minHeight === minHeight) ?? null;
}
