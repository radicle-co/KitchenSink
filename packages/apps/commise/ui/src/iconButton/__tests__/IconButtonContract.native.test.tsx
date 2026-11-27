/**
 * The native icon button's contract beyond its size: a tone, a refused (disabled) state that dims, the handle and
 * disclosure state a host needs, the hint a screen reader reads, and the press fill on the circle. These are what
 * `Stepper`, `ActionMenu` and `SearchField` need before they stop building the control by hand.
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so a held press is stood in for by
 * `pressedPressable`, and the props the leaf hands the `Pressable` are recorded to read the hint. Mutation lens: drop the
 * `disabled` pass-through and the refused row fails; drop the dim and the 40% row fails; paint the press while disabled
 * and the dead-press row fails; drop the hint, ref or `expanded` and its row fails.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { createRef, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pressable as PressableType, View } from 'react-native';

const held = vi.hoisted(() => ({ pressed: false, props: undefined as Record<string, unknown> | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const { pressedPressable } = await import('../../testing/pressedPressable.js');
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());
    const stand = pressedPressable(actual, () => held.pressed);

    return {
        ...actual,
        Pressable: (props: ComponentProps<typeof PressableType>) => {
            held.props = props as Record<string, unknown>;

            return stand(props);
        },
    };
});

import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { rgb, systemScheme } from '../../testing/systemColorScheme.js';
import { role } from '../../tokens/colors.js';
import { themeFor } from '../../theme/themeFor.js';
import { dimmedOpacity } from '../../tokens/scale.js';
import { IconButton } from '../IconButton.native.js';

afterEach(() => {
    cleanup();
    held.pressed = false;
    held.props = undefined;
    systemScheme.current = null;
});

const glyph = (): HTMLElement => {
    const found = document.querySelector<HTMLElement>('[data-commise-stub="icon"]');

    if (found === null) {
        throw new Error('The glyph is not drawn.');
    }

    return found;
};

/** The circle: the element the 44 and the dim and the press fill live on. */
const circleOf = (button: HTMLElement): HTMLElement => {
    const circle = button.firstElementChild?.firstElementChild;

    if (!(circle instanceof HTMLElement)) {
        throw new Error('The button has no circle.');
    }

    return circle;
};

describe('IconButton (native) contract', () => {
    it('draws the glyph in ink by default and in muted ink for the muted tone', () => {
        renderWithTamagui(<IconButton icon="x" accessibilityLabel="Clear" onPress={vi.fn()} />, 'light');
        expect(glyph().dataset['iconColor']).toBe(role.ink);
        cleanup();

        renderWithTamagui(
            <IconButton icon="x" accessibilityLabel="Clear" tone="inkMuted" onPress={vi.fn()} />,
            'light',
        );
        expect(glyph().dataset['iconColor']).toBe(role.inkMuted);
    });

    it('refuses a press and dims the circle to 40% when disabled, and does neither when available', () => {
        const onPress = vi.fn();
        renderWithTamagui(<IconButton icon="x" accessibilityLabel="Clear" disabled onPress={onPress} />, 'light');
        const button = screen.getByRole('button', { name: 'Clear' });

        fireEvent.click(button);

        expect(onPress).not.toHaveBeenCalled();
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(resolvedStyle(circleOf(button), 'opacity')).toBe(String(dimmedOpacity));
        cleanup();

        renderWithTamagui(<IconButton icon="x" accessibilityLabel="Clear" onPress={onPress} />, 'light');
        const live = screen.getByRole('button', { name: 'Clear' });
        fireEvent.click(live);

        expect(onPress).toHaveBeenCalledTimes(1);
        expect(live.hasAttribute('aria-disabled') && live.getAttribute('aria-disabled') === 'true').toBe(false);
        expect(resolvedStyle(circleOf(live), 'opacity')).not.toBe(String(dimmedOpacity));
    });

    it('hands the pressable to a host that asks for it, so a screen-reader cursor can be moved onto it', () => {
        const ref = createRef<View>();
        renderWithTamagui(<IconButton ref={ref} icon="x" accessibilityLabel="Clear" onPress={vi.fn()} />, 'light');

        expect(ref.current).toBe(screen.getByRole('button', { name: 'Clear' }));
    });

    it('says it is expanded or collapsed only when it opens something', () => {
        renderWithTamagui(<IconButton expanded icon="x" accessibilityLabel="Actions" onPress={vi.fn()} />, 'light');
        expect(screen.getByRole('button', { name: 'Actions' }).getAttribute('aria-expanded')).toBe('true');
        cleanup();

        renderWithTamagui(<IconButton icon="x" accessibilityLabel="Actions" onPress={vi.fn()} />, 'light');
        expect(screen.getByRole('button', { name: 'Actions' }).hasAttribute('aria-expanded')).toBe(false);
    });

    it('gives a description to the screen reader as the accessibility hint, and none without one', () => {
        renderWithTamagui(
            <IconButton
                description="Servings must be at least 1."
                icon="minus"
                accessibilityLabel="Fewer"
                onPress={vi.fn()}
            />,
            'light',
        );
        expect(held.props?.['accessibilityHint']).toBe('Servings must be at least 1.');
        cleanup();

        renderWithTamagui(<IconButton icon="minus" accessibilityLabel="Fewer" onPress={vi.fn()} />, 'light');
        expect(held.props?.['accessibilityHint']).toBeUndefined();
    });

    describe.each(['light', 'dark'] as const)('in the %s theme, while the press is held', (scheme) => {
        it('fills the circle with the press fill of the surface it sits on (canvas by default)', () => {
            systemScheme.current = scheme;
            held.pressed = true;
            renderWithTamagui(<IconButton icon="x" accessibilityLabel="Clear" onPress={vi.fn()} />, scheme);

            expect(getComputedStyle(circleOf(screen.getByRole('button', { name: 'Clear' }))).backgroundColor).toBe(
                rgb(themeFor(scheme).press.canvas),
            );
        });

        it('paints no fill on a disabled control, which a press cannot do anything to', () => {
            systemScheme.current = scheme;
            held.pressed = true;
            renderWithTamagui(<IconButton icon="x" accessibilityLabel="Clear" disabled onPress={vi.fn()} />, scheme);

            expect(getComputedStyle(circleOf(screen.getByRole('button', { name: 'Clear' }))).backgroundColor).toBe(
                'rgba(0, 0, 0, 0)',
            );
        });
    });
});
