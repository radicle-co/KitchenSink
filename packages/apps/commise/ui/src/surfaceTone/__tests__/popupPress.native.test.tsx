/**
 * What is INSIDE a native popup, and on a surface, presses to that surface's row (`componentFixes.md` §10, §10a): an
 * action-menu item in its sheet, a combobox option in its list, a popover's trigger on a muted card, a stepper on one, and
 * a chip row's chips on one. Each sits under a muted `Surface`, so a control that read the ambient tone from the wrong
 * place (the field the list belongs to, the card the sheet was opened from) presses to the muted row and fails.
 *
 * ⛔ Written AFTER the code it covers. Its mutation lens: inline `Combobox`'s `OptionRow` back into `Combobox` itself, or
 * drop `BottomSheetPanel`'s `SurfaceToneScope`, and the option and menu-item tests fail.
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so `Pressable` is stood in for by one that
 * renders its `pressed` branch and turns `onPress` into a click; everything above it is the real code.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const press = vi.hoisted(() => ({ pressed: false }));

vi.mock('react-native', async (importOriginal) => {
    const { pressedPressable } = await import('../../testing/pressedPressable.js');
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return { ...actual, Pressable: pressedPressable(actual, () => press.pressed) };
});

import { ActionMenu } from '../../actionMenu/ActionMenu.native.js';
import { ChipRow } from '../../chip/ChipRow.native.js';
import { Combobox } from '../../combobox/Combobox.native.js';
import { Stepper } from '../../input/Stepper.native.js';
import { Popover } from '../../popover/Popover.native.js';
import { rgb, rolesFor, systemScheme } from '../../testing/systemColorScheme.js';
import { themeFor } from '../../theme/themeFor.js';
import { Surface } from '../Surface.native.js';

afterEach(() => {
    cleanup();
    press.pressed = false;
    systemScheme.current = null;
});

const background = (element: HTMLElement): string => getComputedStyle(element).backgroundColor;

/** The first element at or under `element` that paints a background (a pressed row paints on the pressable itself). */
function paintedUnder(element: HTMLElement): string {
    const painted = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))].find(
        (candidate) => background(candidate) !== 'rgba(0, 0, 0, 0)',
    );

    if (painted === undefined) {
        throw new Error('Nothing at or under the element paints a background.');
    }

    return background(painted);
}

describe.each(['light', 'dark'] as const)('in the %s theme, under a muted surface', (scheme) => {
    const theme = themeFor(scheme);

    it('an ActionMenu item in its sheet presses to paperOverlay, not the muted row behind the sheet', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <Surface tone="muted">
                <ActionMenu
                    triggerLabel="Actions for Saffron"
                    title="Saffron"
                    closeLabel="Close actions"
                    items={[{ id: 'tryAgain', label: 'Try again', onSelect: vi.fn() }]}
                />
            </Surface>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Saffron' }));
        const item = screen.getByRole('menuitem', { name: 'Try again' });

        expect(background(item)).toBe(rgb(theme.press.paperOverlay));
        expect(background(item)).not.toBe(rgb(theme.press.muted));
    });

    it('the ActionMenu trigger, which sits on the muted surface, presses to the muted row', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <Surface tone="muted">
                <ActionMenu
                    triggerLabel="Actions for Saffron"
                    title="Saffron"
                    closeLabel="Close actions"
                    items={[{ id: 'tryAgain', label: 'Try again', onSelect: vi.fn() }]}
                />
            </Surface>,
        );

        expect(background(screen.getByRole('button', { name: 'Actions for Saffron' }))).toBe(rgb(theme.press.muted));
    });

    it('a Combobox option in its list presses to paperOverlay, while the field’s own buttons press to the muted row', () => {
        systemScheme.current = scheme;
        press.pressed = true;

        const Host: FC = () => {
            const [value, setValue] = useState('');

            return (
                <Surface tone="muted">
                    <Combobox
                        id="add"
                        label="Add an ingredient"
                        listLabel="Food suggestions"
                        value={value}
                        onValueChange={setValue}
                        groups={
                            value === ''
                                ? []
                                : [{ key: 'own', label: 'Yours', options: [{ key: 'flour', label: 'Flour' }] }]
                        }
                        onSelect={vi.fn()}
                        countAnnouncement=""
                    />
                </Surface>
            );
        };

        render(<Host />);
        fireEvent.focus(screen.getByLabelText('Add an ingredient'));
        fireEvent.change(screen.getByLabelText('Add an ingredient'), { target: { value: 'f' } });
        const option = screen.getByRole('button', { name: 'Flour' });

        expect(background(option)).toBe(rgb(theme.press.paperOverlay));
        expect(background(option)).not.toBe(rgb(theme.press.muted));
    });

    it('a Popover trigger on the muted surface presses to the muted row', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <Surface tone="muted">
                <Popover triggerLabel="About Kale" triggerIcon="info" title="Kale" closeLabel="Close details">
                    <></>
                </Popover>
            </Surface>,
        );

        expect(background(screen.getByRole('button', { name: 'About Kale' }))).toBe(rgb(theme.press.muted));
    });

    it('a Stepper’s step button on the muted surface presses to the muted row', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <Surface tone="muted">
                <Stepper
                    id="servings"
                    label="Servings"
                    value={4}
                    min={1}
                    max={12}
                    onChange={vi.fn()}
                    announce={(next) => `${String(next)} servings`}
                    decreaseLabel="Fewer servings"
                    increaseLabel="More servings"
                />
            </Surface>,
        );

        expect(background(screen.getByRole('button', { name: 'More servings' }))).toBe(rgb(theme.press.muted));
    });

    it('a ChipRow’s chips on the muted surface rest on paper, not surfaceMuted, and press to the paper row', () => {
        systemScheme.current = scheme;
        const Row: FC = () => (
            <Surface tone="muted">
                <ChipRow
                    mode="choice"
                    label="Difficulty"
                    overflow="wrap"
                    options={[
                        { value: 'easy', label: 'Easy' },
                        { value: 'hard', label: 'Hard' },
                    ]}
                    value={null}
                    onChange={vi.fn()}
                    clearable={false}
                />
            </Surface>
        );
        const { rerender } = render(<Row />);

        expect(paintedUnder(screen.getByRole('radio', { name: 'Easy' }))).toBe(rgb(rolesFor(scheme).paper));

        press.pressed = true;
        rerender(<Row />);

        expect(paintedUnder(screen.getByRole('radio', { name: 'Easy' }))).toBe(rgb(theme.press.paper));
    });
});
