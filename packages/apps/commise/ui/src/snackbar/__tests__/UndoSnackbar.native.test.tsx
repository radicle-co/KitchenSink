/**
 * The native Undo snackbar states the INVERSE surface (`componentFixes.md` §10b): the bar paints `inverse`, and its Undo
 * action presses to the inverse row of the press table, in both themes. Written before the change.
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so `Pressable` is stood in for by one that
 * renders its `pressed` branch.
 */
import { cleanup, screen } from '@testing-library/react';
import { elevationBoxShadow } from '../../testing/elevationShadow.js';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { snackbarBarOf, undoFrameOf } from '../../testing/undoSnackbarParts.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const press = vi.hoisted(() => ({ pressed: false }));
/** The system text size the test sets, read through `useWindowDimensions`. */
const text = vi.hoisted(() => ({ scale: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const { pressedPressable } = await import('../../testing/pressedPressable.js');
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return {
        ...actual,
        Pressable: pressedPressable(actual, () => press.pressed),
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), fontScale: text.scale }),
    };
});

import { rgb, rolesFor, systemScheme } from '../../testing/systemColorScheme.js';
import { themeFor } from '../../theme/themeFor.js';
import { UndoSnackbar } from '../UndoSnackbar.native.js';

afterEach(() => {
    cleanup();
    press.pressed = false;
    text.scale = 1;
    systemScheme.current = null;
});

describe.each(['light', 'dark'] as const)('UndoSnackbar (native), %s theme', (scheme) => {
    it('paints the inverse fill on the bar', () => {
        systemScheme.current = scheme;
        renderWithTamagui(
            <UndoSnackbar
                message="Recipe deleted"
                action={{ label: 'Undo', onAction: vi.fn() }}
                onPause={vi.fn()}
                onResume={vi.fn()}
            />,
            scheme,
        );

        const bar = snackbarBarOf(screen.getByText('Recipe deleted'), screen.getByRole('button', { name: 'Undo' }));

        expect(resolvedColour(bar, 'backgroundColor')).toBe(rgb(rolesFor(scheme).inverse));
    });

    it('lifts the bar with the lg level of the elevation table whole (mutant: no level, or another one)', () => {
        systemScheme.current = scheme;
        renderWithTamagui(
            <UndoSnackbar
                message="Recipe deleted"
                action={{ label: 'Undo', onAction: vi.fn() }}
                onPause={vi.fn()}
                onResume={vi.fn()}
            />,
            scheme,
        );
        const bar = snackbarBarOf(screen.getByText('Recipe deleted'), screen.getByRole('button', { name: 'Undo' }));

        expect(resolvedStyle(bar, 'boxShadow')).toBe(elevationBoxShadow('lg'));
    });

    it('presses the Undo action to the inverse row of the press table', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        renderWithTamagui(
            <UndoSnackbar
                message="Recipe deleted"
                action={{ label: 'Undo', onAction: vi.fn() }}
                onPause={vi.fn()}
                onResume={vi.fn()}
            />,
            scheme,
        );

        expect(resolvedColour(undoFrameOf(screen.getByRole('button', { name: 'Undo' })), 'backgroundColor')).toBe(
            rgb(themeFor(scheme).press.inverse),
        );
    });
});

describe('UndoSnackbar (native), a message of any length (issue 409, owner ruling: it never clamps)', () => {
    const LONG = 'Can\u2019t undo. The recipe changed since. Open its versions to check.';

    const renderLong = (): HTMLElement => {
        renderWithTamagui(
            <UndoSnackbar
                message={LONG}
                action={{ label: 'Undo', onAction: vi.fn() }}
                onPause={vi.fn()}
                onResume={vi.fn()}
            />,
            'light',
        );

        return screen.getByText(LONG);
    };

    it('shows the whole message and never clamps or cuts it (mutant: numberOfLines back)', () => {
        const message = renderLong();
        const style = getComputedStyle(message);

        expect(message.textContent).toBe(LONG);
        // react-native-web draws numberOfLines as a line clamp with hidden overflow.
        expect(style.getPropertyValue('-webkit-line-clamp')).toBe('');
        expect(style.overflow).not.toBe('hidden');
    });

    it('wraps the row, so Undo drops under a message with no room, at the end (mutant: no wrap)', () => {
        const message = renderLong();
        const undo = screen.getByRole('button', { name: 'Undo' });

        expect(resolvedStyle(snackbarBarOf(message, undo), 'flexWrap')).toBe('wrap');
        expect(resolvedStyle(undo.parentElement as HTMLElement, 'marginLeft')).toBe('auto');
        // Undo keeps its touch target on its own row.
        expect(resolvedStyle(undoFrameOf(undo), 'minHeight')).toBe('44px');
        expect(resolvedStyle(undoFrameOf(undo), 'minWidth')).toBe('44px');
    });

    it.each([
        [1, '128px'],
        [1.5, '192px'],
        [2, '256px'],
        [3, '256px'],
    ])(
        'asks for 8 text units of room at text size %s, capped at 2x, so Undo drops as text grows (%s)',
        (scale, basis) => {
            text.scale = scale;

            expect(resolvedStyle(renderLong().parentElement as HTMLElement, 'flexBasis')).toBe(basis);
        },
    );

    it('lets the message shrink and grow so it wraps by words (mutant: no shrink)', () => {
        const box = renderLong().parentElement as HTMLElement;

        expect(resolvedStyle(box, 'flexGrow')).toBe('1');
        expect(resolvedStyle(box, 'flexShrink')).toBe('1');
        expect(resolvedStyle(box, 'minWidth')).toBe('0px');
    });
});
