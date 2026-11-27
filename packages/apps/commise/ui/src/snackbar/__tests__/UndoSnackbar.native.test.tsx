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

describe('UndoSnackbar (native), a message of any length (issue 409, owner ruling: it never clamps)', () => {
    const LONG = 'Can\u2019t undo. The recipe changed since. Open its versions to check.';

    const renderLong = (): HTMLElement => {
        render(
            <UndoSnackbar
                message={LONG}
                action={{ label: 'Undo', onAction: vi.fn() }}
                onPause={vi.fn()}
                onResume={vi.fn()}
            />,
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

    it('wraps the row, so Undo moves under a message with no room beside it, at the end (mutant: row cannot wrap)', () => {
        const message = renderLong();
        const undo = screen.getByRole('button', { name: 'Undo' });

        expect(getComputedStyle(message.parentElement as HTMLElement).flexWrap).toBe('wrap');
        expect(getComputedStyle(undo).marginLeft).toBe('auto');
        // Undo keeps its touch target on its own row.
        expect(getComputedStyle(undo).minHeight).not.toBe('');
    });

    it.each([
        [1, '128px'],
        [1.5, '192px'],
        [2, '256px'],
        [3, '256px'],
    ])(
        'asks for 8 text units of room at system text size %s, capped at 2x, so Undo moves down as text grows (basis %s)',
        (scale, basis) => {
            text.scale = scale;

            expect(getComputedStyle(renderLong()).flexBasis).toBe(basis);
        },
    );

    it('lets the message shrink and grow so it wraps by words (mutant: no shrink)', () => {
        const style = getComputedStyle(renderLong());

        expect(style.flexGrow).toBe('1');
        expect(style.flexShrink).toBe('1');
        expect(style.minWidth).toBe('0px');
    });
});
