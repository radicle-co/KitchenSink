/**
 * A native control presses to the press fill of the SURFACE it sits on (`componentFixes.md` §10, §10a), with no `over`
 * prop and no per-site wash. Proved on the real Button, the real "Screen on" switch and the real Chip, in each of the four
 * tones, in the light and the dark theme, and across a popup root: a sheet opened from a muted card presses to the
 * paperOverlay row, not the muted one behind it (the portal case a CSS-only design cannot get wrong, and a context-only
 * design must).
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events (see `PressScale.native.test`), so
 * `Pressable` is stood in for by one that renders its `pressed` branch; everything above it is the real code.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const press = vi.hoisted(() => ({ pressed: false }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');
    const { createElement } = await import('react');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return {
        ...actual,
        Pressable: (props: {
            readonly children: unknown;
            readonly style: (state: { pressed: boolean }) => Record<string, unknown>;
            readonly accessibilityRole?: 'button';
            readonly accessibilityLabel?: string;
            readonly role?: string;
            readonly 'aria-label'?: string;
            readonly 'aria-checked'?: boolean;
        }) =>
            createElement(
                actual.View,
                {
                    role: (props.role ?? props.accessibilityRole) as never,
                    'aria-label': props['aria-label'] ?? props.accessibilityLabel,
                    'aria-checked': props['aria-checked'],
                    style: typeof props.style === 'function' ? props.style({ pressed: press.pressed }) : props.style,
                },
                typeof props.children === 'function'
                    ? (props.children as (state: { pressed: boolean }) => never)({ pressed: press.pressed })
                    : (props.children as never),
            ),
    };
});

import { Button } from '../../button/Button.native.js';
import { Chip } from '../../chip/Chip.native.js';
import { KeepAwakeToggle } from '../../keepAwake/KeepAwakeToggle.native.js';
import { BottomSheetPanel } from '../../sheet/BottomSheetPanel.native.js';
import { rgb, rolesFor, systemScheme } from '../../testing/systemColorScheme.js';
import { themeFor } from '../../theme/themeFor.js';
import { chipPressToneOf, SURFACE_TONE_NAMES, SURFACE_TONES } from '../surfaceTone.js';
import { Surface } from '../Surface.native.js';

afterEach(() => {
    cleanup();
    press.pressed = false;
    systemScheme.current = null;
});

/** The painted pill: the first rounded element inside the control. */
function pillOf(control: HTMLElement): HTMLElement {
    const pill = [control, ...Array.from(control.querySelectorAll<HTMLElement>('*'))].find(
        (element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) > 0,
    );

    if (pill === undefined) {
        throw new Error('The control paints no rounded surface.');
    }

    return pill;
}

const fill = (control: HTMLElement): string => getComputedStyle(pillOf(control)).backgroundColor;

describe.each(['light', 'dark'] as const)('a pressed control in the %s theme', (scheme) => {
    const theme = themeFor(scheme);

    describe.each(SURFACE_TONE_NAMES)('on a %s surface', (tone) => {
        it.each(['secondary', 'quiet', 'ghost'] as const)('Button %s presses to the tone’s press fill', (variant) => {
            systemScheme.current = scheme;
            press.pressed = true;
            render(
                <Surface tone={tone}>
                    {variant === 'secondary' ? (
                        <Button variant="secondary" icon="check">
                            Press me
                        </Button>
                    ) : (
                        <Button variant={variant}>Press me</Button>
                    )}
                </Surface>,
            );

            expect(fill(screen.getByRole('button', { name: 'Press me' }))).toBe(rgb(theme.press[tone]));
        });

        it('the Screen on switch (off) presses to the tone’s press fill', () => {
            systemScheme.current = scheme;
            press.pressed = true;
            render(
                <Surface tone={tone}>
                    <KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" display="labelled" />
                </Surface>,
            );

            expect(fill(screen.getByRole('switch', { name: 'Screen on' }))).toBe(rgb(theme.press[tone]));
        });

        it('a chip rests on the surface’s chip fill and presses to that fill’s row', () => {
            systemScheme.current = scheme;
            const { rerender } = render(
                <Surface tone={tone}>
                    <Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />
                </Surface>,
            );
            const chip = (): HTMLElement => screen.getByRole('checkbox', { name: 'Vegan' });

            expect(fill(chip())).toBe(rgb(rolesFor(scheme)[SURFACE_TONES[tone].chipFill]));

            press.pressed = true;
            rerender(
                <Surface tone={tone}>
                    <Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />
                </Surface>,
            );

            expect(fill(chip())).toBe(rgb(theme.press[chipPressToneOf(tone)]));
        });
    });

    it('outside every surface, a Button presses to the canvas row', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(<Button variant="quiet">Press me</Button>);

        expect(fill(screen.getByRole('button', { name: 'Press me' }))).toBe(rgb(theme.press.canvas));
    });

    it('the innermost surface wins', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <Surface tone="paper">
                <Surface tone="muted">
                    <Button variant="quiet">Inner</Button>
                </Surface>
            </Surface>,
        );

        expect(fill(screen.getByRole('button', { name: 'Inner' }))).toBe(rgb(theme.press.muted));
    });

    it('PORTAL: a control in a sheet opened from a muted surface presses to the paperOverlay row, not the muted one', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <Surface tone="muted">
                <BottomSheetPanel
                    title="Sheet"
                    closeLabel="Close"
                    size="content"
                    focusSignal={0}
                    reduceMotion
                    onClose={vi.fn()}
                >
                    <Button variant="quiet">In the sheet</Button>
                </BottomSheetPanel>
            </Surface>,
        );

        expect(fill(screen.getByRole('button', { name: 'In the sheet' }))).toBe(rgb(theme.press.paperOverlay));
        expect(fill(screen.getByRole('button', { name: 'In the sheet' }))).not.toBe(rgb(theme.press.muted));
    });

    it('a filled Button keeps its own darkening press, whatever the surface', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        render(
            <Surface tone="muted">
                <Button icon="check">Save</Button>
            </Surface>,
        );

        expect(fill(screen.getByRole('button', { name: 'Save' }))).toBe(rgb(rolesFor(scheme).actionPressed));
    });
});
