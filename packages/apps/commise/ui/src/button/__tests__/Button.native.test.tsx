import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text } from 'react-native';
import type { ReactElement } from 'react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Button } from '../Button.native.js';

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
});
