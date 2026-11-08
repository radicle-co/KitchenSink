/**
 * A pressed native `CollectionPickerRow` takes the press fill of the surface it sits on (`componentFixes.md` §10a).

 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so once the row is on screen `Pressable`
 * is stood in for by one that renders its `pressed` branch; everything above it is the real code.
 */
import { themeFor } from '@commise/ui/theme';
import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@commise/i18n/react';
import { makeRecipe } from '@kitchensink/recipe-core/testing';
import { Surface } from '@commise/ui/surface-tone';

import { CollectionPickerRow } from '../CollectionPickerRow.native.js';
import { render } from '@commise/ui/testing/tamagui';

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

describe.each(['light', 'dark'] as const)('a pressed CollectionPickerRow in the %s theme', (scheme) => {
    it.each(['canvas', 'paper'] as const)('on a %s surface presses to that surface’s press fill', (tone) => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <LocaleProvider locale="en">
                <Surface tone={tone}>
                    <CollectionPickerRow
                        recipe={makeRecipe({ id: 'rec_1', title: 'Pasta' })}
                        checked={false}
                        failed={undefined}
                        onToggle={vi.fn()}
                    />
                </Surface>
            </LocaleProvider>,
        );
        const fill = getComputedStyle(screen.getByRole('checkbox', { name: 'Pasta' })).backgroundColor;

        expect(fill).toBe(rgb(themeFor(scheme).press[tone]));
        expect(fill).not.toBe(rgb(rolesFor(scheme).surfaceMuted));
    });
});
