/**
 * A pressed option of the native My recipes sort menu takes the press fill of the sheet it sits in (`componentFixes.md` §10a).
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so once the row is on screen `Pressable`
 * is stood in for by one that renders its `pressed` branch; everything above it is the real code.
 */
import { themeFor } from '@commise/ui/theme';
import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@commise/i18n/react';

import { LibrarySortMenu } from '../LibrarySortMenu.native.js';

const press = vi.hoisted(() => ({ pressed: false }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const { pressedPressable } = await import('@commise/ui/testing/pressed-pressable');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return { ...actual, Pressable: pressedPressable(actual, () => press.pressed) };
});

afterEach(() => {
    cleanup();
    press.pressed = false;
    systemScheme.current = null;
});

describe.each(['light', 'dark'] as const)('a pressed library sort option in the %s theme', (scheme) => {
    it('presses to the press fill of the sheet it sits in (paperOverlay), not surfaceMuted', () => {
        systemScheme.current = scheme;
        const tree = (): ReactElement => (
            <LocaleProvider locale="en">
                <LibrarySortMenu value="updatedAt" onChange={vi.fn()} />
            </LocaleProvider>
        );
        const { rerender } = render(tree());

        fireEvent.click(screen.getByRole('button', { name: /^Sort:/u }));
        press.pressed = true;
        rerender(tree());
        const fill = getComputedStyle(screen.getAllByRole('radio')[0] as HTMLElement).backgroundColor;

        expect(fill).toBe(rgb(themeFor(scheme).press.paperOverlay));
        expect(fill).not.toBe(rgb(rolesFor(scheme).surfaceMuted));
    });
});
