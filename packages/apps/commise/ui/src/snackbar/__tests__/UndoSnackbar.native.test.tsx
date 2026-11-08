/**
 * The native Undo snackbar states the INVERSE surface (`componentFixes.md` §10b): the bar paints `inverse`, and its Undo
 * action presses to the inverse row of the press table, in both themes. Written before the change.
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so `Pressable` is stood in for by one that
 * renders its `pressed` branch.
 */
import { cleanup, screen } from '@testing-library/react';
import { render } from '../../testing/tamaguiTesting.native.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const press = vi.hoisted(() => ({ pressed: false }));

vi.mock('react-native', async (importOriginal) => {
    const { pressedPressable } = await import('../../testing/pressedPressable.js');
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return { ...actual, Pressable: pressedPressable(actual, () => press.pressed) };
});

import { rgb, rolesFor, systemScheme } from '../../testing/systemColorScheme.js';
import { themeFor } from '../../theme/themeFor.js';
import { UndoSnackbar } from '../UndoSnackbar.native.js';

afterEach(() => {
    cleanup();
    press.pressed = false;
    systemScheme.current = null;
});

describe.each(['light', 'dark'] as const)('UndoSnackbar (native), %s theme', (scheme) => {
    it('paints the inverse fill on the bar', () => {
        systemScheme.current = scheme;
        render(
            <UndoSnackbar
                message="Recipe deleted"
                action={{ label: 'Undo', onAction: vi.fn() }}
                onPause={vi.fn()}
                onResume={vi.fn()}
            />,
        );
        const bar = screen.getByText('Recipe deleted').parentElement as HTMLElement;

        expect(getComputedStyle(bar).backgroundColor).toBe(rgb(rolesFor(scheme).inverse));
    });

    it('presses the Undo action to the inverse row of the press table', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <UndoSnackbar
                message="Recipe deleted"
                action={{ label: 'Undo', onAction: vi.fn() }}
                onPause={vi.fn()}
                onResume={vi.fn()}
            />,
        );

        expect(getComputedStyle(screen.getByRole('button', { name: 'Undo' })).backgroundColor).toBe(
            rgb(themeFor(scheme).press.inverse),
        );
    });
});
